// One player for the theme's sounds, run by macOS's own osascript:
//   osascript -l JavaScript player.js <requests folder>
//
// Every clip plays from this one process, so the speakers get one audio
// stream for the session instead of one stream opened and closed per clip,
// which made the Apple Studio Display's speakers buzz until replugged.
//
// The mod drops one request per file into the folder, the names sorting in the
// order sent, each file ending with a line break once written whole:
//   play <id> <volume 0-1> <absolute path of the clip>
//   stop <id>
//   quit
// The player answers on standard output, a line each: `ready` once it reads
// requests, `done <id>` when a clip has played or was stopped, `failed <id>`
// for one it could not play, and `bye` when it leaves: told to, or after
// IDLE_EXIT_S with nothing asked of it.
//
// For tests: HALLOWEEN_PLAYER_LOG names a file that gets every request read
// and every answer given, and HALLOWEEN_PLAYER_IDLE_EXIT_S shortens the wait
// before an idle player leaves.
ObjC.import('Foundation')
ObjC.import('AVFoundation')

/** How often the folder is read: often while clips come, seldom once they stop. */
const POLL_BUSY_S = 0.015
const POLL_RESTING_S = 0.06
const BUSY_S = 3
const IDLE_EXIT_S = Number(ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('HALLOWEEN_PLAYER_IDLE_EXIT_S'))) || 120
/** Request folders of earlier runs left this long are swept away. */
const STALE_FOLDER_S = 24 * 60 * 60
/** Players kept loaded, per clip, to play it again without reading the file. */
const SPARES_PER_CLIP = 2

function run(argv) {
  const folder = argv[0]
  const files = $.NSFileManager.defaultManager
  const out = $.NSFileHandle.fileHandleWithStandardOutput
  // A test sets HALLOWEEN_PLAYER_LOG to a file to follow what the player reads and answers.
  const logPath = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('HALLOWEEN_PLAYER_LOG'))
  const log = line => {
    if (!logPath) return
    const handle = $.NSFileHandle.fileHandleForWritingAtPath(logPath)
    if (handle.isNil()) {
      $(`${line}\n`).writeToFileAtomicallyEncodingError(logPath, true, $.NSUTF8StringEncoding, null)
      return
    }
    handle.seekToEndOfFile
    handle.writeData($(`${line}\n`).dataUsingEncoding($.NSUTF8StringEncoding))
    handle.closeFile
  }
  const say = line => {
    log(`> ${line}`)
    out.writeData($(`${line}\n`).dataUsingEncoding($.NSUTF8StringEncoding))
  }
  const now = () => $.NSDate.date.timeIntervalSince1970
  const listOf = path => ObjC.deepUnwrap(files.contentsOfDirectoryAtPathError(path, null)) || []

  /** Clips playing: id -> { player, path }. */
  const playing = new Map()
  /** Loaded players resting, per clip path. */
  const spares = new Map()

  const playerFor = path => {
    const rested = spares.get(path)?.pop()
    if (rested !== undefined) {
      rested.player.currentTime = 0
      return rested
    }
    const player = $.AVAudioPlayer.alloc.initWithContentsOfURLError($.NSURL.fileURLWithPath(path), null)
    if (player.isNil()) return undefined
    player.prepareToPlay
    return { player, path }
  }

  const rest = entry => {
    const list = spares.get(entry.path) ?? []
    if (list.length < SPARES_PER_CLIP) list.push(entry)
    spares.set(entry.path, list)
  }

  const finish = (id, word) => {
    const entry = playing.get(id)
    if (entry === undefined) return
    if (entry.player.isPlaying) entry.player.stop
    playing.delete(id)
    rest(entry)
    say(`${word} ${id}`)
  }

  const play = (id, volume, path) => {
    const entry = playerFor(path)
    if (entry === undefined) {
      say(`failed ${id}`)
      return
    }
    entry.player.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1
    if (!entry.player.play) {
      say(`failed ${id}`)
      return
    }
    playing.set(id, entry)
  }

  // Sweep request folders an earlier run left behind (a run that was killed cannot sweep its own).
  const parent = $(folder).stringByDeletingLastPathComponent.js
  for (const name of listOf(parent)) {
    const path = `${parent}/${name}`
    const modified = files.attributesOfItemAtPathError(path, null).fileModificationDate
    if (path !== folder && !modified.isNil() && now() - modified.timeIntervalSince1970 > STALE_FOLDER_S) {
      files.removeItemAtPathError(path, null)
    }
  }

  say('ready')
  let lastAsked = now()

  for (;;) {
    for (const name of listOf(folder).filter(each => each.endsWith('.req')).sort()) {
      const path = `${folder}/${name}`
      const text = ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null)) || ''
      if (!text.endsWith('\n')) continue
      files.removeItemAtPathError(path, null)
      lastAsked = now()
      log(`< ${text.trim()}`)
      const [kind, id, volume, ...clip] = text.trim().split(' ')
      if (kind === 'quit') {
        say('bye')
        return
      }
      if (kind === 'play') play(id, Number(volume), clip.join(' '))
      if (kind === 'stop') finish(id, 'done')
    }

    for (const [id, entry] of playing) {
      if (!entry.player.isPlaying) finish(id, 'done')
    }

    if (playing.size === 0 && now() - lastAsked > IDLE_EXIT_S) {
      files.removeItemAtPathError(folder, null)
      say('bye')
      return
    }
    $.NSThread.sleepForTimeInterval(playing.size > 0 || now() - lastAsked < BUSY_S ? POLL_BUSY_S : POLL_RESTING_S)
  }
}
