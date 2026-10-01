import type { BatSpot } from '../types'

import { noise } from './noise'

/**
 * A flock of bats crossing a region of the conversation. Every bat flies whole
 * journeys: in from one edge, along a swooping arc in a direction of its own,
 * out over another edge, then a rest off-stage before the next one.
 *
 * Pure: where every bat is follows from the flock's seed and the tick alone,
 * so a redraw at any moment lands each bat where it should be.
 */

type Point = { x: number; y: number }

type Edge = 'left' | 'right' | 'top' | 'bottom'

/** Ticks one bat's cycle of journey plus rest lasts, at least and at most. */
const SHORTEST_CYCLE = 50
const LONGEST_CYCLE = 95
/** Ticks a bat rests off-stage between two journeys, at least and at most. */
const SHORTEST_REST = 4
const LONGEST_REST = 18

const EDGES: readonly Edge[] = ['left', 'right', 'left', 'right', 'left', 'right', 'top', 'bottom']

function edgeOf(roll: number): Edge {
  return EDGES[Math.floor(roll * EDGES.length)] ?? 'left'
}

/** A point just outside the region on the given edge, `along` it in [0, 1). */
function pointOn(edge: Edge, along: number, columns: number, rows: number): Point {
  switch (edge) {
    case 'left':
      return { x: -3, y: along * rows }
    case 'right':
      return { x: columns + 1, y: along * rows }
    case 'top':
      return { x: along * columns, y: -2 }
    case 'bottom':
      return { x: along * columns, y: rows + 1 }
  }
}

/**
 * Where journey `journey` of bat `bat` starts, bends and ends, and how long
 * the bat rests after it. Every journey of a bat takes the same time, so a
 * long diagonal is flown faster than a short hop between two edges.
 */
function journeyOf(seed: number, bat: number, journey: number, columns: number, rows: number) {
  const roll = (salt: number): number => noise(seed, bat, journey, salt)
  const from = edgeOf(roll(1))
  let to = edgeOf(roll(2))

  if (to === from) {
    to = from === 'left' ? 'right' : from === 'right' ? 'left' : from === 'top' ? 'bottom' : 'top'
  }

  const start = pointOn(from, roll(3), columns, rows)
  const end = pointOn(to, roll(4), columns, rows)
  const bend = { x: (0.1 + roll(5) * 0.8) * columns, y: roll(6) * rows }
  const rest = SHORTEST_REST + Math.floor(roll(7) * (LONGEST_REST - SHORTEST_REST))

  return { start, bend, end, rest, flutter: roll(8) * Math.PI * 2 }
}

/** The width a cycle's length is set for; a wider conversation takes longer to cross. */
const CYCLE_COLUMNS = 110

function cycleLengthOf(seed: number, bat: number, columns: number): number {
  const cycle = SHORTEST_CYCLE + Math.floor(noise(seed, bat, 0) * (LONGEST_CYCLE - SHORTEST_CYCLE))

  return Math.round(cycle * Math.max(1, columns / CYCLE_COLUMNS))
}

/**
 * Where bat `bat` is at `tick`, or `undefined` while it rests between
 * journeys. Positions may lie outside the region as it enters and leaves.
 */
export function batAt(seed: number, bat: number, columns: number, rows: number, tick: number): BatSpot | undefined {
  const cycle = cycleLengthOf(seed, bat, columns)
  const shifted = tick + Math.floor(noise(seed, bat, 9) * cycle)
  const journey = Math.floor(shifted / cycle)
  const elapsed = shifted % cycle
  const { start, bend, end, rest, flutter } = journeyOf(seed, bat, journey, columns, rows)
  const duration = cycle - rest

  if (elapsed > duration) {
    return undefined
  }

  const t = elapsed / duration
  const along = (from: number, via: number, to: number): number =>
    (1 - t) * (1 - t) * from + 2 * (1 - t) * t * via + t * t * to
  const bob = Math.sin(elapsed * 0.9 + flutter) * 0.6

  return {
    x: Math.round(along(start.x, bend.x, end.x)),
    y: Math.round(along(start.y, bend.y, end.y) + bob),
  }
}

/** How many bats a region of this size holds: more room, a bigger flock. */
export function flockSize(columns: number, rows: number): number {
  return Math.min(28, Math.max(10, Math.round((columns * rows) / 200)))
}

/** Every bat of the flock inside the region at `tick`. */
export function flockAt(seed: number, columns: number, rows: number, tick: number): BatSpot[] {
  const spots: BatSpot[] = []

  for (let bat = 0; bat < flockSize(columns, rows); bat++) {
    const spot = batAt(seed, bat, columns, rows, tick)

    if (spot !== undefined && spot.x >= 0 && spot.x <= columns - 2 && spot.y >= 0 && spot.y < rows) {
      spots.push(spot)
    }
  }

  return spots
}
