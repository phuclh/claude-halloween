import type { BatSpot } from '../types'

import { noise } from './noise'

/**
 * A flock of bats crossing a region of the conversation. Every bat flies whole
 * journeys: in over one side, across at a steady pace while rising or falling
 * along a gentle arc of its own, out over the other side, then a rest
 * off-stage before the next one, which may head the other way.
 *
 * Steady is what makes it smooth: a bat moves the same one or two cells every
 * tick, and its height eases along a curve that never leaves the region, so
 * no frame jumps further than the one before.
 *
 * Pure: where every bat is follows from the flock's seed and the tick alone,
 * so a redraw at any moment lands each bat where it should be.
 */

/** Cells past each side a journey starts and ends, so a bat enters and leaves out of sight. */
const OFFSTAGE = 3
/** Ticks a bat rests off-stage between two journeys, at least and at most. */
const SHORTEST_REST = 6
const LONGEST_REST = 40

/** Cells a bat moves each tick: half the flock cruise, half dart. */
function paceOf(seed: number, bat: number): number {
  return noise(seed, bat, 1) < 0.5 ? 1 : 2
}

function restOf(seed: number, bat: number): number {
  return SHORTEST_REST + Math.floor(noise(seed, bat, 2) * (LONGEST_REST - SHORTEST_REST))
}

/**
 * Which way journey `journey` of bat `bat` crosses, and the heights it starts
 * at, bends toward and ends at, all inside the region's rows.
 */
function journeyOf(seed: number, bat: number, journey: number, rows: number) {
  const roll = (salt: number): number => noise(seed, bat, journey, salt)
  const lowest = Math.max(0, rows - 1)

  return {
    isLeftward: roll(1) < 0.5,
    from: roll(2) * lowest,
    bend: roll(3) * lowest,
    to: roll(4) * lowest,
  }
}

/**
 * Where bat `bat` is at `tick`, or `undefined` while it rests between
 * journeys. Positions lie past the sides as it enters and leaves.
 */
export function batAt(seed: number, bat: number, columns: number, rows: number, tick: number): BatSpot | undefined {
  const pace = paceOf(seed, bat)
  const flight = Math.ceil((columns + OFFSTAGE * 2) / pace)
  const cycle = flight + restOf(seed, bat)
  const shifted = tick + Math.floor(noise(seed, bat, 9) * cycle)
  const elapsed = shifted % cycle

  if (elapsed >= flight) {
    return undefined
  }

  const { isLeftward, from, bend, to } = journeyOf(seed, bat, Math.floor(shifted / cycle), rows)
  const travelled = elapsed * pace
  const t = elapsed / flight
  const height = (1 - t) * (1 - t) * from + 2 * (1 - t) * t * bend + t * t * to

  return {
    x: isLeftward ? columns + OFFSTAGE - 2 - travelled : -OFFSTAGE + travelled,
    y: Math.round(height),
  }
}

/** How many bats a region of this size holds: more room, a bigger flock. */
export function flockSize(columns: number, rows: number): number {
  return Math.min(12, Math.max(4, Math.round((columns * rows) / 500)))
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
