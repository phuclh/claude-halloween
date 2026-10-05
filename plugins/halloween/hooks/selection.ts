/**
 * Telling a selection the person made from one the flock changed.
 *
 * The engine reads a highlighted selection off the screen, so a bat flying
 * over it changes its text: the bat stands where the characters under it
 * were, two cells wide, one or two characters (none where the line's trailing
 * spaces were trimmed).
 */

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether `current` is `settled` with bats over some of it, and nothing else changed. */
export function isUnderBats(settled: string, current: string, bat: string): boolean {
  if (!current.includes(bat)) {
    return false
  }

  const pattern = current.split(bat).map(escapeRegExp).join('[^\\n]{0,2}')

  return new RegExp(`^${pattern}$`, 'u').test(settled)
}
