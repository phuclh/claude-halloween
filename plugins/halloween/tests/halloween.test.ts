import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { batAt, flockSize } from '../hooks/bats'
import { bottomRuleCells, createFrameLayout, PALETTE, topRuleCells } from '../hooks/frame'

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

const FULLSCREEN = { columns: 60, rows: 30, isFullscreen: true }

const PROMPT_HINT = {
  plugin: 'halloween',
  surface: 'terminal',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  viewport: FULLSCREEN,
} as const

/** A repeatable random source, so a layout test rolls the same scatter every run. */
function seededRandom(seed: number): () => number {
  let state = seed

  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296

    return state / 4294967296
  }
}

/** Answers what a session start needs beneath the plugin, on a mocked clock it hands back. */
function sessionBeneath(on: On) {
  const clock = mock.clock(on)
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))

  return clock
}

const TERMINAL_SESSION = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const

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
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return Text({ children: e.props.hint })
  })
  const isFramed = async () => {
    const hint = await $.ui.mount(PROMPT_HINT)
    const rules = (await hint.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute')
    await hint.unmount()

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
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return Text({ children: e.props.hint })
  })

  await $.session.start(TERMINAL_SESSION)

  const hint = await $.ui.mount(PROMPT_HINT)
  expect((await hint.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute')).toHaveLength(0)
})

test('the haunted frame sits on the prompt box rules and follows a growing draft', async ($, on) => {
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return Text({ children: e.props.hint })
  })
  let draft = ''
  on('prompt.fill', ($, e) => {
    draft = e.text

    return { isFilled: true }
  })
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))

  const hint = await $.ui.mount(PROMPT_HINT)
  const ruleRows = async () =>
    (await hint.findAll({ type: 'Box' }))
      .filter(box => box.props.position === 'absolute' && box.props.width === FULLSCREEN.columns)
      .map(box => box.props.top)
  const sides = async () =>
    (await hint.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute' && box.props.left === 56)

  expect(await ruleRows()).toEqual([-5, -3])
  expect(await sides()).toHaveLength(1)
  expect(await hint.find({ type: 'Text', text: /🎃/ })).toBeDefined()
  expect(await hint.find({ type: 'Text', text: /\? for shortcuts/ })).toBeDefined()

  await $.prompt.fill({ text: 'one\ntwo', mode: 'replace', origin: { kind: 'engine' } })

  expect(await ruleRows()).toEqual([-6, -3])
  expect(await sides()).toHaveLength(2)
})

test('the frame animates on its own clock once the session starts', async ($, on) => {
  const clock = sessionBeneath(on)
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return Text({ children: e.props.hint })
  })

  await $.session.start(TERMINAL_SESSION)
  const hint = await $.ui.mount(PROMPT_HINT)
  const frames = new Set<string>()

  for (let step = 0; step < 12; step++) {
    frames.add(JSON.stringify(await hint.drawn()))
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

test('every bat flies whole journeys, in over one edge and out over another, with no jumps', () => {
  const columns = 110
  const rows = 30
  const isOutside = (spot: { x: number; y: number }) =>
    spot.x < 0 || spot.x > columns - 2 || spot.y < 0 || spot.y >= rows

  for (let bat = 0; bat < flockSize(columns, rows); bat++) {
    let journey: { x: number; y: number }[] = []
    let journeys = 0

    for (let tick = 0; tick < 600; tick++) {
      const spot = batAt(4242, bat, columns, rows, tick)
      const last = journey[journey.length - 1]

      if (spot !== undefined && last !== undefined) {
        expect(Math.abs(spot.x - last.x)).toBeLessThanOrEqual(8)
        expect(Math.abs(spot.y - last.y)).toBeLessThanOrEqual(3)
      }

      if (spot !== undefined) {
        journey.push(spot)
        continue
      }

      if (journey.length > 0 && tick > journey.length) {
        expect(isOutside(journey[0]!) || journey.length === tick).toBe(true)
        expect(isOutside(journey[journey.length - 1]!)).toBe(true)
        journeys++
      }

      journey = []
    }

    expect(journeys).toBeGreaterThan(3)
  }
})
