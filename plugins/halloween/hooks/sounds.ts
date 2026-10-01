/**
 * The theme's sounds: as the person types, a bat squeaks or, now and then,
 * lightning cracks; when they send a prompt, a laugh, a ghost, a pipe organ
 * or a thunderclap answers.
 *
 * The clips are the plugin's own files under sounds/, synthesized from
 * oscillators and noise by the repository's scripts/render-sounds.ts.
 */

export const BAT_CLIPS = ['sounds/bat-1.wav', 'sounds/bat-2.wav', 'sounds/bat-3.wav', 'sounds/bat-4.wav'] as const
export const CRACK_CLIPS = ['sounds/crack-1.wav', 'sounds/crack-2.wav'] as const
export const ENTER_CLIPS = [
  'sounds/laugh-villain.wav',
  'sounds/laugh-witch.wav',
  'sounds/laugh-demon.wav',
  'sounds/ghost.wav',
  'sounds/organ.wav',
  'sounds/thunder.wav',
] as const

/** Fewest milliseconds between two keystroke sounds, so fast typing or a held key never drones. */
export const KEYSTROKE_GAP_MS = 70

/** The share of keystrokes that crack lightning instead of a bat squeak. */
const CRACK_SHARE = 0.2

/** One edit of the prompt box, as `prompt.edit` carries it. */
type Edit = { start: number; end: number; inputText: string }

const randomOf = <T>(list: readonly T[], random: () => number): T =>
  list[Math.floor(random() * list.length)] as T

/**
 * The clip an edit plays: none for a bare cursor move or within
 * KEYSTROKE_GAP_MS of the last one, else a bat or, now and then, a crack.
 */
export function keystrokeClip(edit: Edit, msSinceLast: number, random: () => number = Math.random): string | undefined {
  const isChange = edit.inputText !== '' || edit.end > edit.start

  if (!isChange || msSinceLast < KEYSTROKE_GAP_MS) {
    return undefined
  }

  return randomOf(random() < CRACK_SHARE ? CRACK_CLIPS : BAT_CLIPS, random)
}

/**
 * Deals the Enter clips: each once in a shuffled round before any comes
 * again, and never one twice in a row where two rounds meet.
 */
export function createEnterDeck(random: () => number = Math.random): () => string {
  let round: string[] = []
  let last: string | undefined

  return () => {
    if (round.length === 0) {
      round = [...ENTER_CLIPS]

      for (let index = round.length - 1; index > 0; index--) {
        const other = Math.floor(random() * (index + 1))
        ;[round[index], round[other]] = [round[other] as string, round[index] as string]
      }

      if (round[round.length - 1] === last) {
        ;[round[0], round[round.length - 1]] = [round[round.length - 1] as string, round[0] as string]
      }
    }

    last = round.pop() as string

    return last
  }
}
