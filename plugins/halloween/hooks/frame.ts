/**
 * The haunted frame around the prompt box: a violet night edge above with
 * perched bats and a drifting ghost, a moss vine below where jack-o'-lanterns
 * grow in random clumps and flicker their glow onto the vine.
 *
 * Pure: a session's layout is rolled once, and every frame is drawn from it
 * and the animation tick, so redraws never reshuffle anything.
 */

import { noise } from './noise'

/** One terminal cell; `null` is the right half of the emoji to its left. */
export type Cell = { glyph: string; color?: string } | null

/** Something sitting on a rule, at a fraction of the rule's length. */
type Prop = { at: number; glyph: string }

export type FrameLayout = {
  seed: number
  top: Prop[]
  bottom: Prop[]
  corners: { topLeft: string; topRight: string; bottomLeft: string; bottomRight: string }
  sides: string[]
}

export const PALETTE = {
  dusk: '#6B4E9B',
  moss: '#5E7D32',
  ember: ['#FFE08A', '#FF9F43', '#D9531E'],
  ecto: ['#C8FFE0', '#7FE0A8', '#3F8F6A'],
} as const

const LANTERN = '🎃'
const GHOST = '👻'
const RULE = '─'
const HOT_RULE = '━'
const VINE_CURL = '∿'

/** Ticks the ghost waits off-stage between two crossings. */
const GHOST_PAUSE_TICKS = 70

const TOP_POOL = ['🦇', '🦇', '🦇', '🦇', '🦇', '🍁', '🍂', '💀']
const BOTTOM_POOL = [LANTERN, LANTERN, LANTERN, LANTERN, '🍂', '🍂', '🍁', '🍁', '🦴', '🍄', '💀', '🍬']
const SIDE_POOL = ['💀', '🦴', '🥀', '🍂', '🍁']

const randomOf = <T>(list: readonly T[], random: () => number): T =>
  list[Math.floor(random() * list.length)] as T

/**
 * Scatters props along a rule at irregular gaps: mostly wide, now and then a
 * tight clump of two or three, so no two sessions look alike.
 */
function scatter(pool: readonly string[], density: number, random: () => number): Prop[] {
  const props: Prop[] = []
  let at = random() * 0.08

  while (at < 1) {
    props.push({ at, glyph: randomOf(pool, random) })
    const isClump = random() < 0.3
    at += isClump ? 0.015 + random() * 0.02 : (0.05 + random() * 0.14) / density
  }

  return props
}

export function createFrameLayout(random: () => number = Math.random): FrameLayout {
  const top = scatter(TOP_POOL, 0.8, random)
  const moonSpot = top[Math.floor(random() * top.length)]

  if (moonSpot !== undefined) {
    moonSpot.glyph = '🌙'
  }

  return {
    seed: Math.floor(random() * 1_000_000),
    top,
    bottom: scatter(BOTTOM_POOL, 1.1, random),
    corners: {
      topLeft: randomOf(['🦉', '💀', '🔮'], random),
      topRight: randomOf(['🦉', '🔮', '💀'], random),
      bottomLeft: LANTERN,
      bottomRight: randomOf([LANTERN, '🍄', '🦴'], random),
    },
    sides: Array.from({ length: 12 }, () => randomOf(SIDE_POOL, random)),
  }
}

function emptyRule(columns: number, color: string): Cell[] {
  return Array.from({ length: columns }, () => ({ glyph: RULE, color }))
}

/**
 * Lays the props on the rule between the corners, skipping one that would
 * touch another, and answers the columns they landed on.
 */
function placeProps(cells: Cell[], props: readonly Prop[], corners: [string, string]): Map<number, string> {
  const columns = cells.length
  const placed = new Map<number, string>([
    [0, corners[0]],
    [columns - 2, corners[1]],
  ])
  const inner = columns - 8

  for (const prop of props) {
    const column = 3 + Math.floor(prop.at * inner)
    const isCrowded = [-2, -1, 0, 1, 2].some(offset => placed.has(column + offset))

    if (!isCrowded && column + 1 < columns - 3) {
      placed.set(column, prop.glyph)
    }
  }

  for (const [column, glyph] of placed) {
    cells[column] = { glyph }
    cells[column + 1] = null
  }

  return placed
}

/** True for a cell still showing the bare rule, which glow and trails may tint. */
const isBareRule = (cell: Cell | undefined): boolean =>
  cell != null && (cell.glyph === RULE || cell.glyph === VINE_CURL)

/**
 * How far a lantern's glow reaches this tick: mostly its full three cells,
 * guttering to two or one now and then, like a candle in a draught.
 */
function glowReach(seed: number, lantern: number, tick: number): number {
  const flicker = noise(seed, lantern, tick)

  return flicker < 0.2 ? 1 : flicker < 0.55 ? 2 : 3
}

/** The moss vine under the prompt box, its lanterns flickering. */
export function bottomRuleCells(layout: FrameLayout, columns: number, tick: number): Cell[] {
  const cells = emptyRule(columns, PALETTE.moss)

  cells.forEach((cell, column) => {
    if (cell !== null && noise(layout.seed, column, 7) < 0.07) {
      cell.glyph = VINE_CURL
    }
  })

  const placed = placeProps(cells, layout.bottom, [layout.corners.bottomLeft, layout.corners.bottomRight])
  let lantern = 0

  for (const [column, glyph] of placed) {
    if (glyph !== LANTERN) {
      continue
    }

    const reach = glowReach(layout.seed, lantern++, tick)

    for (let distance = 1; distance <= reach; distance++) {
      const color = PALETTE.ember[distance - 1]
      const glyphAt = distance === 1 ? HOT_RULE : RULE

      for (const target of [column - distance, column + 1 + distance]) {
        if (isBareRule(cells[target])) {
          cells[target] = { glyph: glyphAt, color }
        }
      }
    }
  }

  return cells
}

/**
 * The violet night edge over the prompt box, with a ghost drifting along it
 * every so often and a fading trail of ectoplasm behind; no ghost while the
 * scene sleeps.
 */
export function topRuleCells(layout: FrameLayout, columns: number, tick: number, hasGhost = true): Cell[] {
  const cells = emptyRule(columns, PALETTE.dusk)
  placeProps(cells, layout.top, [layout.corners.topLeft, layout.corners.topRight])

  const ghost = (tick % (columns + GHOST_PAUSE_TICKS)) - 2

  if (hasGhost && ghost >= 2 && ghost < columns - 4) {
    PALETTE.ecto.forEach((color, index) => {
      const target = ghost - 1 - index

      if (isBareRule(cells[target])) {
        cells[target] = { glyph: RULE, color }
      }
    })

    if (cells[ghost] === null && ghost > 0) {
      cells[ghost - 1] = { glyph: RULE, color: PALETTE.dusk }
    }

    if (cells[ghost + 2] === null) {
      cells[ghost + 2] = { glyph: RULE, color: PALETTE.dusk }
    }

    cells[ghost] = { glyph: GHOST }
    cells[ghost + 1] = null
  }

  return cells
}

/** What sits at the right end of the prompt box's draft row `index`. */
export function sideGlyph(layout: FrameLayout, index: number): string {
  return layout.sides[index % layout.sides.length] ?? '💀'
}
