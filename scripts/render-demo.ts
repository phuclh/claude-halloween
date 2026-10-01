/**
 * Renders assets/demo.svg, the README's animated demo, from the plugin's own
 * drawing code: the frame's layout, glow and ghost come from frame.ts and
 * every bat flies its real journey from bats.ts, over a sample conversation.
 *
 *   npx -p typescript tsc -p scripts
 *   node .demo-build/scripts/render-demo.js > assets/demo.svg
 */
import { batAt, flockAt, flockSize } from '../plugins/halloween/hooks/bats'
import { bottomRuleCells, createFrameLayout, PALETTE, topRuleCells } from '../plugins/halloween/hooks/frame'
import type { Cell, FrameLayout } from '../plugins/halloween/hooks/frame'

declare const process: { stdout: { write: (text: string) => void } }

const COLUMNS = 84
const CELL_WIDTH = 8.4
const ROW_HEIGHT = 20
const FONT_SIZE = 14
const BASELINE = 15
const PADDING = 20
const TITLE_BAR = 30

const FLIGHT_TICK_MS = 125
/** Ticks searched for the moment the demo opens on: the busiest sky in it. */
const OPENING_SEARCH_TICKS = 400
/** Frame steps the ghost has drifted in when the demo opens. */
const GHOST_HEAD_START = 12
const FRAME_STEP_MS = 250
const FLICKER_STEPS = 48

const INK = {
  window: '#14111c',
  titleBar: '#1d1928',
  text: '#e6e1f0',
  dim: '#8a83a0',
  tool: '#7fc47f',
}

type Run = { column: number; text: string; style?: 'dim' | 'bold' | 'tool' | 'prompt' }

/** The sample conversation, row by row: a short, ordinary turn. */
const CONVERSATION: Run[][] = [
  [{ column: 0, text: '❯', style: 'prompt' }, { column: 2, text: 'add a dark mode toggle to the settings page' }],
  [],
  [{ column: 0, text: '⏺' }, { column: 2, text: "I'll add a toggle under Appearance and remember the choice." }],
  [],
  [{ column: 0, text: '⏺', style: 'tool' }, { column: 2, text: 'Read', style: 'bold' }, { column: 6, text: '(src/pages/settings.tsx)' }],
  [{ column: 2, text: '⎿  Read 84 lines', style: 'dim' }],
  [],
  [{ column: 0, text: '⏺', style: 'tool' }, { column: 2, text: 'Update', style: 'bold' }, { column: 8, text: '(src/pages/settings.tsx)' }],
  [{ column: 2, text: '⎿  Updated src/pages/settings.tsx with 12 additions', style: 'dim' }],
  [],
  [{ column: 0, text: '⏺' }, { column: 2, text: 'Done. The toggle sits under Appearance and is saved to localStorage.' }],
  [],
  [{ column: 0, text: '✻ Brewed for 14s', style: 'dim' }],
  [],
]

const SKY_ROWS = CONVERSATION.length
const TOP_RULE_ROW = SKY_ROWS
const DRAFT_ROW = SKY_ROWS + 1
const BOTTOM_RULE_ROW = SKY_ROWS + 2
const STATUS_ROW = SKY_ROWS + 3
const HINT_ROW = SKY_ROWS + 4
const ROWS = SKY_ROWS + 5

const WIDTH = PADDING * 2 + COLUMNS * CELL_WIDTH
const HEIGHT = TITLE_BAR + 12 + ROWS * ROW_HEIGHT + 16

const css: string[] = []
const fmt = (value: number): string => String(Math.round(value * 100) / 100)
const cellX = (column: number): number => column * CELL_WIDTH
const rowY = (row: number): number => row * ROW_HEIGHT

/** A repeatable random source, so the demo rolls the same scatter every run. */
function seededRandom(seed: number): () => number {
  let state = seed

  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296

    return state / 4294967296
  }
}

/** The first layout with a good spread: several lanterns, bats perched, a moon. */
function showcaseLayout(): FrameLayout {
  for (let seed = 1; ; seed++) {
    const layout = createFrameLayout(seededRandom(seed))
    const bottom = bottomRuleCells(layout, COLUMNS, 0).map(cell => cell?.glyph)
    const top = topRuleCells(layout, COLUMNS, 0, false).map(cell => cell?.glyph)
    const count = (glyphs: (string | undefined)[], glyph: string) => glyphs.filter(each => each === glyph).length

    if (count(bottom, '🎃') >= 5 && count(top, '🦇') >= 3 && top.includes('🌙')) {
      return layout
    }
  }
}

function text(column: number, row: number, content: string, attributes = ''): string {
  const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  return `<text x="${fmt(cellX(column))}" y="${fmt(rowY(row) + BASELINE)}"${attributes}>${escaped}</text>`
}

function line(fromColumn: number, toColumn: number, row: number, color: string, weight: number, attributes = ''): string {
  const y = fmt(rowY(row) + ROW_HEIGHT / 2)

  return `<line x1="${fmt(cellX(fromColumn))}" y1="${y}" x2="${fmt(cellX(toColumn))}" y2="${y}" stroke="${color}" stroke-width="${weight}"${attributes}/>`
}

/** An emoji or glyph sitting on a rule: a patch of window cut out of the line under it. */
function propOnRule(column: number, row: number, glyph: string, color?: string): string {
  const width = glyph.length > 1 ? 2 : 1
  const patch = `<rect x="${fmt(cellX(column) - 0.5)}" y="${fmt(rowY(row) + 3)}" width="${fmt(width * CELL_WIDTH + 1)}" height="${ROW_HEIGHT - 6}" fill="${INK.window}"/>`

  return patch + text(column, row, glyph, color ? ` fill="${color}"` : '')
}

/** The rule's own line and everything sitting on it, as the cells say at one moment. */
function drawRule(cells: readonly Cell[], row: number, baseColor: string): string {
  const parts = [line(0, COLUMNS, row, baseColor, 1.4)]

  cells.forEach((cell, column) => {
    if (cell === null || cell.glyph === '─' || cell.glyph === '━') {
      return
    }

    parts.push(propOnRule(column, row, cell.glyph, cell.color))
  })

  return parts.join('')
}

/**
 * The lanterns' glow: every rule cell whose color changes over the loop gets
 * a segment of its own, its color and weight stepping as the flicker does.
 */
function drawFlicker(layout: FrameLayout): string {
  const frames = Array.from({ length: FLICKER_STEPS }, (_, step) => bottomRuleCells(layout, COLUMNS, step))
  const parts: string[] = []

  for (let column = 0; column < COLUMNS; column++) {
    const looks = frames.map(cells => {
      const cell = cells[column]
      const isGlow = cell != null && (cell.glyph === '━' || (cell.glyph === '─' && cell.color !== PALETTE.moss))

      return isGlow ? { color: cell.color ?? PALETTE.moss, weight: cell.glyph === '━' ? 2.6 : 1.6, opacity: 1 } : undefined
    })

    if (looks.every(look => look === undefined)) {
      continue
    }

    const name = `glow${column}`
    const keyframes: string[] = []
    let previous = ''

    looks.forEach((look, step) => {
      const value = look
        ? `stroke:${look.color};stroke-width:${look.weight}px;opacity:1`
        : 'opacity:0'

      if (value !== previous) {
        keyframes.push(`${fmt((step / FLICKER_STEPS) * 100)}%{${value}}`)
        previous = value
      }
    })

    css.push(`@keyframes ${name}{${keyframes.join('')}}.${name}{animation:${name} ${FLICKER_STEPS * FRAME_STEP_MS}ms step-end infinite}`)
    parts.push(line(column, column + 1, BOTTOM_RULE_ROW, PALETTE.ember[1], 1.6, ` class="${name}"`))
  }

  return parts.join('')
}

/**
 * The ghost drifting along the top rule, on the rule's own period: its trail
 * drawn under the props, the ghost itself over them.
 */
function drawGhost(layout: FrameLayout): { under: string; over: string } {
  const ghostAt = (step: number): number => topRuleCells(layout, COLUMNS, step).findIndex(cell => cell?.glyph === '👻')
  let enter = 0

  while (ghostAt(enter) < 0 || ghostAt(enter - 1) >= 0) {
    enter++
  }

  let next = enter + 1

  while (ghostAt(next) < 0 || ghostAt(next - 1) >= 0) {
    next++
  }

  const period = next - enter
  const keyframes: string[] = []

  for (let step = 0; step < period; step++) {
    const column = ghostAt(enter + step)
    const value = column < 0 ? 'opacity:0' : `opacity:1;transform:translate(${fmt(cellX(column))}px,0)`
    keyframes.push(`${fmt((step / period) * 100)}%{${value}}`)
  }

  const delay = -GHOST_HEAD_START * FRAME_STEP_MS
  css.push(
    `@keyframes ghost{${keyframes.join('')}}.ghost{animation:ghost ${period * FRAME_STEP_MS}ms step-end ${delay}ms infinite}`,
  )

  const trail = PALETTE.ecto.map((color, index) => line(-1 - index, -index, TOP_RULE_ROW, color, 1.8)).join('')

  return {
    under: `<g class="ghost">${trail}</g>`,
    over: `<g class="ghost">${propOnRule(0, TOP_RULE_ROW, '👻')}</g>`,
  }
}

/** The tick with the most bats in the air, so the demo opens on a lively sky. */
function busiestTick(): number {
  let busiest = 0
  let most = -1

  for (let tick = 0; tick < OPENING_SEARCH_TICKS; tick++) {
    const flying = flockAt(7, COLUMNS, SKY_ROWS, tick).length

    if (flying > most) {
      most = flying
      busiest = tick
    }
  }

  return busiest
}

/**
 * Every bat of the flock on a loop of its own: one whole journey and the rest
 * after it, so the flock never lines up the same way twice.
 */
function drawBats(): string {
  const parts: string[] = []
  const opening = busiestTick()

  for (let bat = 0; bat < flockSize(COLUMNS, SKY_ROWS); bat++) {
    const at = (tick: number) => batAt(7, bat, COLUMNS, SKY_ROWS, tick)
    let start = 1

    while (at(start) === undefined || at(start - 1) !== undefined) {
      start++
    }

    let end = start + 1

    while (at(end) === undefined || at(end - 1) !== undefined) {
      end++
    }

    const period = end - start
    const keyframes: string[] = []
    let previous = ''

    for (let tick = start; tick < end; tick++) {
      const spot = at(tick)
      const value = spot
        ? `transform:translate(${fmt(cellX(spot.x))}px,${fmt(rowY(spot.y))}px)`
        : 'transform:translate(-40px,-40px)'

      if (value !== previous) {
        keyframes.push(`${fmt(((tick - start) / period) * 100)}%{${value}}`)
        previous = value
      }
    }

    const delay = -((((opening - start) % period) + period) % period) * FLIGHT_TICK_MS
    css.push(
      `@keyframes bat${bat}{${keyframes.join('')}}.bat${bat}{animation:bat${bat} ${period * FLIGHT_TICK_MS}ms step-end ${delay}ms infinite}`,
    )
    parts.push(`<text class="bat${bat}" x="0" y="${BASELINE}" transform="translate(-40,-40)">🦇</text>`)
  }

  return parts.join('')
}

function drawRun(run: Run, row: number): string {
  const styles = {
    dim: ` fill="${INK.dim}"`,
    bold: ' font-weight="700"',
    tool: ` fill="${INK.tool}"`,
    prompt: ` fill="${INK.dim}"`,
  }

  return text(run.column, row, run.text, run.style ? styles[run.style] : '')
}

function render(): string {
  const layout = showcaseLayout()
  const ghost = drawGhost(layout)
  const conversation = CONVERSATION.flatMap((runs, row) => runs.map(run => drawRun(run, row))).join('')
  const bats = drawBats()
  const flicker = drawFlicker(layout)
  const topRule = drawRule(topRuleCells(layout, COLUMNS, 0, false), TOP_RULE_ROW, PALETTE.dusk)
  const bottomRule = drawRule(bottomRuleCells(layout, COLUMNS, 0), BOTTOM_RULE_ROW, PALETTE.moss)
  const prompt = [
    text(0, DRAFT_ROW, '❯', ` fill="${INK.dim}"`),
    text(2, DRAFT_ROW, 'make the bats fly'),
    text(COLUMNS - 2, DRAFT_ROW, '🥀'),
    text(2, STATUS_ROW, 'Opus 5.5 · ~/projects/app', ` fill="${INK.dim}"`),
    text(COLUMNS - 16, STATUS_ROW, '🦇 spooky season', ` fill="${INK.dim}"`),
    text(2, HINT_ROW, '? for shortcuts', ` fill="${INK.dim}"`),
  ].join('')
  const dots = ['#ff5f57', '#febc2e', '#28c840']
    .map((color, index) => `<circle cx="${18 + index * 18}" cy="${TITLE_BAR / 2}" r="5.5" fill="${color}" opacity="0.85"/>`)
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(WIDTH)}" height="${fmt(HEIGHT)}" viewBox="0 0 ${fmt(WIDTH)} ${fmt(HEIGHT)}" role="img" aria-label="Claude Code with the Halloween theme: bats fly across the conversation above a prompt framed by flickering jack-o'-lanterns, leaves and skulls">
<style>
text{font-family:ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;font-size:${FONT_SIZE}px;white-space:pre}
${css.join('\n')}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<defs><clipPath id="sky"><rect x="0" y="0" width="${fmt(COLUMNS * CELL_WIDTH)}" height="${fmt(SKY_ROWS * ROW_HEIGHT)}"/></clipPath></defs>
<rect width="100%" height="100%" rx="12" fill="${INK.window}"/>
<path d="M0 12a12 12 0 0 1 12-12h${fmt(WIDTH - 24)}a12 12 0 0 1 12 12v${TITLE_BAR - 12}h-${fmt(WIDTH)}z" fill="${INK.titleBar}"/>
${dots}
<g transform="translate(${PADDING},${TITLE_BAR + 12})" fill="${INK.text}">
${conversation}
<g clip-path="url(#sky)">${bats}</g>
${ghost.under}${topRule}${ghost.over}
${prompt}
${bottomRule}${flicker}
</g>
</svg>
`
}

process.stdout.write(render())
