/**
 * How text lays out in terminal cells, for placing the frame around the
 * prompt box: the draft's rows and the footer labels' width.
 *
 * Text is measured by grapheme cluster, as the terminal draws it: an emoji
 * with its skin tone, variation selector or zero-width-joined parts is one
 * cluster, as is a letter with its combining marks.
 */

const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u
const REGIONAL_INDICATOR = /\p{Regional_Indicator}/u
/** Code points that join the cluster before them: marks, variation selectors, skin tones, tag characters. */
const EXTENDER = /[\p{M}‍︀-️\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u
const ZERO_WIDTH_JOINER = '‍'
const EMOJI_STYLE = '️'

/** True for an East Asian wide or fullwidth code point: CJK, Hangul, fullwidth forms. */
function isWideCode(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}

/**
 * Splits text into the clusters a terminal draws as one glyph: a code point,
 * the extenders after it, whatever a zero-width joiner joins on, and regional
 * indicators in pairs (a flag).
 */
export function clustersOf(text: string): string[] {
  const clusters: string[] = []
  let isJoining = false

  for (const character of text) {
    const last = clusters[clusters.length - 1]
    const isFlagHalf =
      last !== undefined &&
      REGIONAL_INDICATOR.test(character) &&
      Array.from(last).length === 1 &&
      REGIONAL_INDICATOR.test(last)

    if (last !== undefined && (isJoining || EXTENDER.test(character) || isFlagHalf)) {
      clusters[clusters.length - 1] = last + character
    } else {
      clusters.push(character)
    }

    isJoining = character === ZERO_WIDTH_JOINER
  }

  return clusters
}

/**
 * Cells a cluster takes: two for an emoji drawn as one (emoji presentation,
 * a pictograph asked for in emoji style, or a flag) or an East Asian wide
 * character; none for marks with nothing to sit on; one for the rest.
 */
export function cellsOf(cluster: string): number {
  const code = cluster.codePointAt(0) ?? 0
  const isEmoji =
    EMOJI_PRESENTATION.test(cluster) ||
    (cluster.includes(EMOJI_STYLE) && PICTOGRAPHIC.test(cluster)) ||
    REGIONAL_INDICATOR.test(cluster)

  if (isEmoji || isWideCode(code)) {
    return 2
  }

  return EXTENDER.test(String.fromCodePoint(code)) ? 0 : 1
}

/** Cells a text takes on one line. */
export function widthOf(text: string): number {
  return clustersOf(text).reduce((cells, cluster) => cells + cellsOf(cluster), 0)
}

/**
 * Rows one line takes wrapped to `width` cells, as the composer wraps it:
 * wrap-ansi's rules with `hard: true, trim: false`. Words move whole to the
 * next row; a space is kept at the end of the row it wrapped from; a word
 * wider than a row is broken across rows, starting on the current row only
 * when that does not take more breaks.
 */
function rowsOfLine(line: string, width: number): number {
  let rows = 1
  let rowLength = 0

  line.split(' ').forEach((word, index) => {
    const length = widthOf(word)

    if (index !== 0) {
      if (rowLength >= width) {
        rows++
        rowLength = 0
      }

      rowLength++
    }

    if (length > width) {
      const breaksStartingThisRow = 1 + Math.floor((length - (width - rowLength) - 1) / width)
      const breaksStartingNextRow = Math.floor((length - 1) / width)

      if (breaksStartingNextRow < breaksStartingThisRow) {
        rows++
        rowLength = 0
      }

      const clusters = clustersOf(word)

      clusters.forEach((cluster, at) => {
        const cells = cellsOf(cluster)

        if (rowLength + cells > width) {
          rows++
          rowLength = 0
        }

        rowLength += cells

        if (rowLength === width && at < clusters.length - 1) {
          rows++
          rowLength = 0
        }
      })

      return
    }

    if (rowLength + length > width && rowLength > 0 && length > 0) {
      rows++
      rowLength = 0
    }

    rowLength += length
  })

  return rows
}

/** Rows a draft takes in a prompt box drawn `columns` wide: its lines, each wrapped to the box. */
export function rowsOfDraft(text: string, columns: number): number {
  const width = Math.max(10, columns - 4)

  return text.split('\n').reduce((rows, line) => rows + rowsOfLine(line, width), 0)
}
