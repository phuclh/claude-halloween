/** A stable pseudo-random value in [0, 1) for a few integers. */
export function noise(...values: number[]): number {
  let hash = 2166136261

  for (const value of values) {
    hash = Math.imul(hash ^ (value | 0), 16777619)
    hash ^= hash >>> 13
  }

  return ((hash >>> 0) % 10007) / 10007
}
