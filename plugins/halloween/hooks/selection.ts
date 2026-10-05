/**
 * Telling a selection the person made from one the flock changed.
 *
 * The engine reads a highlighted selection off the screen, so a bat flying
 * over it changes its text: the bat stands where the characters under it
 * were, two cells wide, one or two characters (none where the line's trailing
 * spaces were trimmed).
 */

/** Characters of a line a bat can stand over. */
const MOST_UNDER_BAT = 2

/** Where `part` ends when read from each of `starts`, for the starts it matches at. */
function pastPart(text: readonly string[], part: readonly string[], starts: ReadonlySet<number>): Set<number> {
  const ends = new Set<number>()

  for (const start of starts) {
    if (part.every((character, index) => text[start + index] === character)) {
      ends.add(start + part.length)
    }
  }

  return ends
}

/** Where a bat standing at each of `starts` ends: over none, one or two characters of a line. */
function pastBat(text: readonly string[], starts: ReadonlySet<number>): Set<number> {
  const ends = new Set<number>()

  for (const start of starts) {
    ends.add(start)

    for (let end = start; end < start + MOST_UNDER_BAT && end < text.length && text[end] !== '\n'; end++) {
      ends.add(end + 1)
    }
  }

  return ends
}

/**
 * Whether `current` is `settled` with bats over some of it, and nothing else
 * changed. Reads both once, character by character, keeping every place the
 * text read so far can end, so a selection full of bats costs no more than
 * its length.
 */
export function isUnderBats(settled: string, current: string, bat: string): boolean {
  if (!current.includes(bat)) {
    return false
  }

  const text = Array.from(settled)
  const [first = [], ...rest] = current.split(bat).map(part => Array.from(part))
  let ends = pastPart(text, first, new Set([0]))

  for (const part of rest) {
    if (ends.size === 0) {
      return false
    }

    ends = pastPart(text, part, pastBat(text, ends))
  }

  return ends.has(text.length)
}
