import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { batAt, flockSize } from '../hooks/bats'
import { bottomRuleCells, createFrameLayout, PALETTE, topRuleCells } from '../hooks/frame'
import { BAT_CLIPS, CRACK_CLIPS, ENTER_CLIPS, KEYSTROKE_GAP_MS, keystrokeClip } from '../hooks/sounds'

const BAND = {
  plugin: 'halloween',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const HALLOWEEN_COMMAND = {
  command: 'halloween',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

const SOUNDS_COMMAND = { ...HALLOWEEN_COMMAND, args: 'sounds' } as const

/** The person pressing Enter on a prompt. */
const ENTER = { text: 'boo', wait: false, origin: { kind: 'composer' } } as const

const FULLSCREEN = { columns: 60, rows: 30, isFullscreen: true }

/** The footer's mode labels, which the frame hangs from, in the fullscreen terminal. */
const MODE_LABELS = {
  plugin: 'halloween',
  surface: 'terminal',
  component: 'SessionMode',
  props: { modes: [] },
  viewport: FULLSCREEN,
} as const

/** Draws the mode labels as the engine would: joined, on one row. */
function drawModeLabels(on: On): void {
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return Text({ children: e.props.modes.join(' & ') })
  })
}

/** The frame's pieces placed against the labels: rules span the terminal, sides sit at its right edge. */
async function framePieces(labels: { findAll: (query: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) {
  const placed = (await labels.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute')

  return {
    rules: placed.filter(box => box.props.width === FULLSCREEN.columns).map(box => ({ top: box.props.top, left: box.props.left })),
    sides: placed.filter(box => box.props.width === undefined).map(box => ({ top: box.props.top, left: box.props.left })),
  }
}

/** A repeatable random source, so a layout test rolls the same scatter every run. */
function seededRandom(seed: number): () => number {
  let state = seed

  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296

    return state / 4294967296
  }
}

/** Answers what a session start needs beneath the plugin, on a mocked clock it hands back. */
function sessionBeneath(on: On, stored: Record<string, unknown> = {}) {
  const clock = mock.clock(on)
  mock.store(on, stored)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))

  return clock
}

const TERMINAL_SESSION = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const

/** Plays clips as the engine beneath would, keeping the list of what played. */
function recordPlays(on: On): string[] {
  const played: string[] = []
  on('audio.play', ($, e) => {
    played.push(e.clip.asset ?? '')

    return { value: undefined }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))

  return played
}

const SPOOKY_SPINNER_WORDS = /Haunting|Brewing|Conjuring|Cackling|Summoning|Bewitching|Lurking|Creeping|Hexing|Spellcasting|Carving pumpkins|Howling|Rattling bones|Stirring the cauldron/

test('the prompt footer and spinner turn spooky', async ($, on) => {
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return Text({ children: `${e.props.hint}${e.props.tail ?? ''}` })
  })
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return Text({ children: `spinner: ${e.props.word}` })
  })

  const hint = await $.ui.mount({
    plugin: 'halloween',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  })
  expect(await hint.find({ type: 'Text', text: /\? for shortcuts\s+🎃 🍁 💀 🍂 🦇/ })).toBeDefined()

  const spinner = await $.ui.mount({
    plugin: 'halloween',
    surface: 'terminal',
    component: 'Spinner',
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' },
  })
  const spinnerText = (await spinner.find({ type: 'Text', text: /^spinner: / }))?.text
  expect(spinnerText).toMatch(SPOOKY_SPINNER_WORDS)
  expect(spinnerText).not.toMatch(/Sauteing/)
})

test('/halloween takes the frame off the prompt box and puts it back', async ($, on) => {
  mock.store(on)
  drawModeLabels(on)
  const isFramed = async () => {
    const labels = await $.ui.mount(MODE_LABELS)
    const { rules } = await framePieces(labels)
    await labels.unmount()

    return rules.length > 0
  }

  const off = await $.command.run(HALLOWEEN_COMMAND)
  expect(off.text).toMatch(/off/)
  expect(await isFramed()).toBe(false)

  const backOn = await $.command.run(HALLOWEEN_COMMAND)
  expect(backOn.text).toMatch(/on/)
  expect(await isFramed()).toBe(true)
})

test('the theme stays off in a new session after /halloween turned it off', async ($, on) => {
  mock.store(on, { isEnabled: false })
  mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  drawModeLabels(on)

  await $.session.start(TERMINAL_SESSION)

  const labels = await $.ui.mount(MODE_LABELS)
  expect((await framePieces(labels)).rules).toHaveLength(0)
  expect(await labels.find({ type: 'Text', text: /spooky season/ })).toBeUndefined()
})

test('the haunted frame hangs from the mode labels onto the prompt box rules and follows a growing draft', async ($, on) => {
  drawModeLabels(on)
  let draft = ''
  on('prompt.fill', ($, e) => {
    draft = e.text

    return { isFilled: true }
  })
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))

  const labels = await $.ui.mount(MODE_LABELS)
  const labelsLeft = FULLSCREEN.columns - 2 - '🦇 spooky season'.length

  expect(await labels.find({ type: 'Text', text: '🦇 spooky season' })).toBeDefined()
  expect(await framePieces(labels)).toEqual({
    rules: [
      { top: -3, left: -labelsLeft },
      { top: -1, left: -labelsLeft },
    ],
    sides: [{ top: -2, left: FULLSCREEN.columns - 2 - labelsLeft }],
  })

  await $.prompt.fill({ text: 'one\ntwo', mode: 'replace', origin: { kind: 'engine' } })

  const { rules, sides } = await framePieces(labels)
  expect(rules.map(rule => rule.top)).toEqual([-4, -1])
  expect(sides.map(side => side.top)).toEqual([-3, -2])
})

test('the frame stays on the prompt box when other mode labels sit beside the theme', async ($, on) => {
  drawModeLabels(on)

  const labels = await $.ui.mount({ ...MODE_LABELS, props: { modes: ['focus'] } })
  const labelsLeft = FULLSCREEN.columns - 2 - 'focus & 🦇 spooky season'.length

  expect((await framePieces(labels)).rules.map(rule => rule.left)).toEqual([-labelsLeft, -labelsLeft])
})

test('the frame animates on its own clock once the session starts', async ($, on) => {
  const clock = sessionBeneath(on)
  drawModeLabels(on)

  await $.session.start(TERMINAL_SESSION)
  const labels = await $.ui.mount(MODE_LABELS)
  const frames = new Set<string>()

  for (let step = 0; step < 12; step++) {
    frames.add(JSON.stringify(await labels.drawn()))
    await clock.advance(250)
  }

  expect(frames.size).toBeGreaterThan(1)
})

test('every rule is exactly as wide as the terminal, lanterns glowing and a ghost passing', () => {
  for (const columns of [30, 61, 110, 200]) {
    const layout = createFrameLayout(seededRandom(columns))
    let hasGlow = false
    let hasGhost = false

    for (let tick = 0; tick < columns + 80; tick++) {
      for (const cells of [topRuleCells(layout, columns, tick), bottomRuleCells(layout, columns, tick)]) {
        expect(cells).toHaveLength(columns)
        cells.forEach((cell, column) => {
          const isWide = cell !== null && cell.glyph.length > 1
          expect(isWide ? cells[column + 1] : 'narrow').toBe(isWide ? null : 'narrow')
        })
        hasGlow ||= cells.some(cell => cell?.color === PALETTE.ember[0])
        hasGhost ||= cells.some(cell => cell?.glyph === '👻')
      }
    }

    expect(hasGhost).toBe(true)
    expect(hasGlow).toBe(true)
  }
})

test('the newest conversation row on screen carries the flock over the rows above it', async ($, on) => {
  sessionBeneath(on)
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return Text({ children: e.props.text })
  })
  await $.session.start(TERMINAL_SESSION)
  const reply = (text: string, rows: number) => ({
    text,
    isFirstOfReply: true,
    onScreen: { first: 0, last: rows - 1, of: rows },
  })
  const mountReply = (requestId: string, text: string, rows: number) =>
    $.ui.mount({
      plugin: 'halloween',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: reply(text, rows),
      requestId,
      viewport: { columns: 110, rows: 40, isFullscreen: true },
    })
  const batsOn = async (row: Awaited<ReturnType<typeof mountReply>>) =>
    (await row.findAll({ type: 'Box', text: '🦇' })).filter(box => box.props.position === 'absolute')

  const older = await mountReply('flock-older', 'the older reply', 14)
  const newer = await mountReply('flock-newer', 'the newer reply', 12)
  await older.redraw(reply('the older reply', 14))

  const flock = await batsOn(newer)
  expect(flock.length).toBeGreaterThan(0)
  expect(await batsOn(older)).toHaveLength(0)
  expect(flock.some(bat => Number(bat.props.top) < 0)).toBe(true)
  expect(await newer.find({ type: 'Text', text: 'the newer reply' })).toBeDefined()

  await newer.redraw({ ...reply('the newer reply', 12), onScreen: null })
  await older.redraw(reply('the older reply', 14))

  expect(await batsOn(newer)).toHaveLength(0)
  expect((await batsOn(older)).length).toBeGreaterThan(0)
})

test('the scene sleeps after a quiet spell and wakes when the person types', async ($, on) => {
  const clock = sessionBeneath(on)
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return Text({ children: e.props.text })
  })
  on('prompt.fill', () => ({ isFilled: true }))
  on('prompt.read', () => ({ value: { text: 'boo', cursor: 3 } }))
  await $.session.start(TERMINAL_SESSION)

  const props = { text: 'a quiet reply', isFirstOfReply: true, onScreen: { first: 0, last: 19, of: 20 } }
  const reply = await $.ui.mount({
    plugin: 'halloween',
    surface: 'terminal',
    component: 'AssistantMessage',
    props,
    requestId: 'sleepy-reply',
    viewport: { columns: 110, rows: 40, isFullscreen: true },
  })
  const bats = async () =>
    (await reply.findAll({ type: 'Box', text: '🦇' })).filter(box => box.props.position === 'absolute').length

  expect(await bats()).toBeGreaterThan(0)

  await clock.advance(95_000)
  expect(await bats()).toBe(0)
  const asleep = JSON.stringify(await reply.drawn())
  await clock.advance(2_000)
  expect(JSON.stringify(await reply.drawn())).toBe(asleep)

  await $.prompt.fill({ text: 'boo', mode: 'replace', origin: { kind: 'engine' } })
  await clock.advance(500)
  expect(await bats()).toBeGreaterThan(0)
})

test('every bat flies whole, smooth journeys from one side to the other', () => {
  const columns = 110
  const rows = 30
  const isOffstage = (spot: { x: number }) => spot.x < 0 || spot.x > columns - 2

  for (let bat = 0; bat < flockSize(columns, rows); bat++) {
    let journey: { x: number; y: number }[] = []
    let journeys = 0
    const directions = new Set<number>()

    for (let tick = 0; tick < 1200; tick++) {
      const spot = batAt(4242, bat, columns, rows, tick)

      if (spot !== undefined) {
        const last = journey[journey.length - 1]
        const first = journey[1]

        if (last !== undefined && first !== undefined && journey[0] !== undefined) {
          expect(spot.x - last.x).toBe(first.x - journey[0].x)
          expect(Math.abs(spot.y - last.y)).toBeLessThanOrEqual(1)
        }

        journey.push(spot)
        continue
      }

      if (journey.length > 1 && tick > journey.length) {
        expect(isOffstage(journey[0]!)).toBe(true)
        expect(isOffstage(journey[journey.length - 1]!)).toBe(true)
        expect(Math.abs(journey[1]!.x - journey[0]!.x)).toBeLessThanOrEqual(2)
        directions.add(Math.sign(journey[1]!.x - journey[0]!.x))
        journeys++
      }

      journey = []
    }

    expect(journeys).toBeGreaterThan(4)
    expect(directions.size).toBe(2)
  }
})

test('the flock stays small enough to read through', () => {
  expect(flockSize(110, 31)).toBe(7)
  expect(flockSize(60, 15)).toBe(4)
  expect(flockSize(300, 80)).toBe(12)
})

test('Enter stays quiet until /halloween sounds, then never plays the same sound twice running', async ($, on) => {
  mock.store(on)
  const played = recordPlays(on)

  await $.prompt.submit(ENTER)
  expect(played).toEqual([])

  expect((await $.command.run(SOUNDS_COMMAND)).text).toMatch(/sounds on/)
  expect(played).toHaveLength(1)

  for (let enter = 0; enter < 12; enter++) {
    await $.prompt.submit(ENTER)
  }

  const enterClips: readonly string[] = ENTER_CLIPS
  expect(played).toHaveLength(13)
  expect(played.every(clip => enterClips.includes(clip))).toBe(true)
  expect(new Set(played).size).toBe(ENTER_CLIPS.length)
  played.slice(1).forEach((clip, index) => expect(clip).not.toBe(played[index]))

  expect((await $.command.run(SOUNDS_COMMAND)).text).toMatch(/sounds off/)
  await $.prompt.submit(ENTER)
  expect(played).toHaveLength(13)
})

test('the sounds stay on in a new session, for the person\'s own Enter, and hush while the theme is off', async ($, on) => {
  sessionBeneath(on, { hasSounds: true })
  const played = recordPlays(on)
  await $.session.start(TERMINAL_SESSION)

  await $.prompt.submit(ENTER)
  expect(played).toHaveLength(1)

  await $.prompt.submit({ ...ENTER, origin: { kind: 'task-notification' } })
  expect(played).toHaveLength(1)

  await $.command.run(HALLOWEEN_COMMAND)
  await $.prompt.submit(ENTER)
  expect(played).toHaveLength(1)
})

test('a keystroke squeaks like a bat or cracks like lightning, but not for a cursor move or faster than the gap', () => {
  const typed = { start: 3, end: 3, inputText: 'o' }
  const keystrokeClips: readonly (string | undefined)[] = [...BAT_CLIPS, ...CRACK_CLIPS]
  const crackClips: readonly (string | undefined)[] = CRACK_CLIPS
  const random = seededRandom(7)
  const clips = Array.from({ length: 200 }, () => keystrokeClip(typed, KEYSTROKE_GAP_MS, random))
  const cracks = clips.filter(clip => crackClips.includes(clip)).length

  expect(clips.every(clip => keystrokeClips.includes(clip))).toBe(true)
  expect(cracks).toBeGreaterThan(10)
  expect(cracks).toBeLessThan(clips.length / 2)
  expect(keystrokeClip({ start: 2, end: 3, inputText: '' }, 1000)).toBeDefined()
  expect(keystrokeClip({ start: 1, end: 1, inputText: '' }, 1000)).toBeUndefined()
  expect(keystrokeClip(typed, KEYSTROKE_GAP_MS - 1)).toBeUndefined()
})

test('/halloween sounds brings the theme back with it, and a mistyped option changes nothing', async ($, on) => {
  mock.store(on)
  drawModeLabels(on)
  const played = recordPlays(on)
  const isFramed = async () => {
    const labels = await $.ui.mount(MODE_LABELS)
    const { rules } = await framePieces(labels)
    await labels.unmount()

    return rules.length > 0
  }

  expect((await $.command.run({ ...HALLOWEEN_COMMAND, args: 'souunds' })).text).toMatch(/No option "souunds"/)
  expect(await isFramed()).toBe(true)

  await $.command.run(HALLOWEEN_COMMAND)
  expect(await isFramed()).toBe(false)

  expect((await $.command.run(SOUNDS_COMMAND)).text).toMatch(/sounds on, and the Halloween theme with them/)
  expect(await isFramed()).toBe(true)
  expect(played).toHaveLength(1)
})
