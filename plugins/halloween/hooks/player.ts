/**
 * Plays the theme's clips through one long-running player, player/player.js
 * run by macOS's own osascript, so the speakers get one audio stream for the
 * session instead of one opened and closed for every clip: a stream per key
 * made the Apple Studio Display's speakers buzz until they were replugged.
 *
 * The mod hands the player a request per file in a folder of its own and reads
 * its answers from the player's output (player.js describes both). Where the
 * player cannot start, as off macOS, `play` answers false and the caller plays
 * the clip some other way.
 */

/** What the player needs from the engine, so a test can stand in for it. */
export type PlayerHost = {
  /** The plugin's folder, absolute: the clips and player.js are under it. */
  root: string
  /** A folder of the plugin's own to keep the requests in. */
  dataFolder: () => Promise<string>
  /** Starts the player, yielding what it writes, piece by piece, for as long as it runs. */
  spawn: (argv: readonly string[]) => AsyncIterable<{ stream: string; text: string }>
  /** Writes a whole file, making its folders. */
  write: (path: string, text: string) => Promise<void>
  /** Resolves after `ms` milliseconds. */
  sleep: (ms: number) => Promise<void>
}

export type Player = {
  /**
   * Plays `clip` (a path under the plugin's folder) until it ends or `signal`
   * aborts. False when the player could not play it, for the caller to play
   * it another way.
   */
  play: (host: PlayerHost, clip: string, signal?: AbortSignal) => Promise<boolean>
}

/** How long a starting player may take to say it is ready. */
export const PLAYER_READY_MS = 3_000
/** Starts that may fail before the session stops trying the player. */
const STARTS_ALLOWED_TO_FAIL = 2

type Status = 'off' | 'starting' | 'ready' | 'broken'

/** A run's own name for its request folder: a fresh one each load, so no run reads another's requests. */
const runName = (): string => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`

export function createPlayer(): Player {
  let status: Status = 'off'
  let ready: Promise<boolean> = Promise.resolve(false)
  let folder = ''
  let failedStarts = 0
  let requests = 0
  let clips = 0
  /** Clips playing, by id: what settles each one's `play`. */
  const waiting = new Map<string, (isPlayed: boolean) => void>()

  const settle = (id: string, isPlayed: boolean): void => {
    waiting.get(id)?.(isPlayed)
    waiting.delete(id)
  }

  const ask = (host: PlayerHost, line: string): Promise<void> =>
    host.write(`${folder}/${String(++requests).padStart(10, '0')}.req`, `${line}\n`)

  const start = (host: PlayerHost): void => {
    status = 'starting'
    let markReady: (isReady: boolean) => void = () => undefined
    ready = new Promise(resolve => (markReady = resolve))

    void (async () => {
      let isReady = false

      try {
        folder = `${await host.dataFolder()}/player/${runName()}`
        let unread = ''

        for await (const piece of host.spawn(['/usr/bin/osascript', '-l', 'JavaScript', `${host.root}/player/player.js`, folder])) {
          if (piece.stream !== 'stdout') {
            continue
          }

          const lines = (unread + piece.text).split('\n')
          unread = lines.pop() ?? ''

          for (const line of lines) {
            const [word, id] = line.trim().split(' ')

            if (word === 'ready') {
              isReady = true
              status = 'ready'
              failedStarts = 0
              markReady(true)
            } else if ((word === 'done' || word === 'failed') && id !== undefined) {
              settle(id, word === 'done')
            }
          }
        }
      } catch {
        // It could not start, or its output ended in an error: as if it left.
      }

      if (!isReady) {
        failedStarts++
      }

      status = failedStarts >= STARTS_ALLOWED_TO_FAIL ? 'broken' : 'off'
      markReady(false)

      // Whatever was playing ended with the player.
      for (const id of [...waiting.keys()]) {
        settle(id, true)
      }
    })()
  }

  return {
    play: async (host, clip, signal) => {
      if (status === 'broken') {
        return false
      }

      if (status === 'off') {
        start(host)
      }

      const isReady = status === 'ready' || (await Promise.race([ready, host.sleep(PLAYER_READY_MS).then(() => false)]))

      if (!isReady) {
        return false
      }

      if (signal?.aborted === true) {
        return true
      }

      const id = `c${++clips}`
      const played = new Promise<boolean>(resolve => waiting.set(id, resolve))

      try {
        await ask(host, `play ${id} 1 ${host.root}/${clip}`)
      } catch {
        settle(id, false)

        return false
      }

      // Stopped: the player stops it a moment later, and the caller moves on now.
      signal?.addEventListener(
        'abort',
        () => {
          settle(id, true)
          void ask(host, `stop ${id}`).catch(() => undefined)
        },
        { once: true },
      )

      return played
    },
  }
}
