// Checks the theme's player on this Mac, silently: it plays a real clip at
// volume 0 several times over, each after the last has ended, plays another
// clip and stops one mid-way, then reads the player's log to see that every
// clip really started. (Playing to its end once must not leave a clip silent
// the next time.)
//   node scripts/check-player.mjs
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../plugins/halloween/', import.meta.url).pathname
const CLIP = `${ROOT}sounds/bat-1.wav`
const OTHER = `${ROOT}sounds/laugh-witch.wav`
const work = mkdtempSync(join(tmpdir(), 'halloween-player-'))
const folder = join(work, 'player', 'check')
const log = join(work, 'player.log')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
mkdirSync(folder, { recursive: true })

const player = spawn('/usr/bin/osascript', ['-l', 'JavaScript', `${ROOT}player/player.js`, folder], {
  env: { ...process.env, HALLOWEEN_PLAYER_LOG: log },
  stdio: ['ignore', 'pipe', 'inherit'],
})
let answers = ''
player.stdout.on('data', chunk => (answers += chunk))

let sent = 0
const ask = line => {
  const name = join(folder, `${String(++sent).padStart(10, '0')}`)
  writeFileSync(`${name}.tmp`, `${line}\n`)
  renameSync(`${name}.tmp`, `${name}.req`)
}

try {
  for (let wait = 0; !answers.includes('ready') && wait < 100; wait++) await sleep(100)
  if (!answers.includes('ready')) throw new Error('the player never said it was ready')

  for (let round = 1; round <= 4; round++) {
    ask(`play same${round} 0 ${CLIP}`)
    await sleep(500)
  }
  ask(`play other 0 ${OTHER}`)
  await sleep(200)
  ask('stop other')
  await sleep(300)
  ask(`play again 0 ${OTHER}`)
  await sleep(300)
  ask('quit')
  for (let wait = 0; !answers.includes('bye') && wait < 50; wait++) await sleep(100)

  const started = readFileSync(log, 'utf8').split('\n').filter(line => line.startsWith('started '))
  const silent = started.filter(line => !line.endsWith(' true'))
  console.log(started.join('\n'))
  if (started.length !== 6 || silent.length > 0) throw new Error(`${silent.length} of ${started.length} clips did not start`)
  console.log('every clip started')
} catch (error) {
  console.error(String(error))
  process.exitCode = 1
} finally {
  player.kill()
  rmSync(work, { recursive: true, force: true })
}
