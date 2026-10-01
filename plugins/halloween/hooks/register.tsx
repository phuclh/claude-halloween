import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderElement, RenderInput, RenderNode, Timer } from 'claude-code'

import { flockAt } from './bats'
import { bottomRuleCells, createFrameLayout, sideGlyph, topRuleCells } from './frame'
import type { Cell } from './frame'

const isEnabled = atom({ plugin: 'halloween', key: 'isEnabled' } as const, true)
const draftRows = atom({ plugin: 'halloween', key: 'draftRows' } as const, 1)
const frameTick = atom({ plugin: 'halloween', key: 'frameTick' } as const, 0)
const flightTick = atom({ plugin: 'halloween', key: 'flightTick' } as const, 0)
const isAwake = atom({ plugin: 'halloween', key: 'isAwake' } as const, false)

const STORE_KEY = 'isEnabled'
/**
 * One clock drives everything: the bats move every tick, the frame every
 * other tick, so both land in the same redraw. With no typing and no turn
 * running for IDLE_MS the clock stops and the scene sleeps, costing nothing.
 */
const ANIMATION_TICK_MS = 125
const TICKS_PER_FRAME_STEP = 2
const IDLE_MS = 90_000
const IDLE_TICKS = Math.round(IDLE_MS / ANIMATION_TICK_MS)
const MIN_FRAME_COLUMNS = 30

/** The hint line's garland, for where the frame cannot be drawn. */
const HINT_TAIL = '   🎃 🍁 💀 🍂 🦇'
const SPOOKY_MODE = '🦇 spooky season'

/**
 * Where the prompt box sits relative to the hint line under it in the
 * fullscreen terminal: the hint site starts two columns in, the bottom rule is
 * three rows up (past the status line), the draft rows above it, then the top
 * rule.
 */
const HINT_INDENT = 2
const BOTTOM_RULE_ROW = -3

const BAT = '🦇'

/**
 * Screen rows below the conversation besides the draft: the line above the
 * prompt box, its two rules, the status line, the hint line and room for a
 * notice. Erring high keeps bats off the conversation's top edge.
 */
const PROMPT_AREA_ROWS = 8

/** The conversation rows whose newest one carries the flock. */
type TranscriptSite = RenderInput<'AssistantMessage' | 'UserMessage' | 'CommandOutput' | 'ToolUse'>

const SPINNER_WORDS = [
  'Haunting',
  'Brewing',
  'Conjuring',
  'Cackling',
  'Summoning',
  'Bewitching',
  'Lurking',
  'Creeping',
  'Hexing',
  'Spellcasting',
  'Carving pumpkins',
  'Howling',
  'Rattling bones',
  'Stirring the cauldron',
]

const PAST_WORDS = [
  'Haunted',
  'Brewed',
  'Conjured',
  'Cackled',
  'Summoned',
  'Bewitched',
  'Lurked',
  'Crept',
  'Hexed',
  'Carved',
  'Howled',
]

/** The terminal's width as the prompt box last drew, for wrapping the draft. */
let promptColumns = 80

/** This load's scatter of props on the frame: rolled once, so redraws keep it. */
const frameLayout = createFrameLayout()

/** This load's flock: every journey of every bat follows from it. */
const flockSeed = Math.floor(Math.random() * 1_000_000)

/** The order each conversation row was first drawn in; the latest is the newest row. */
const rowOrder = new Map<string, number>()

/** The running animation clock and how many ticks have passed with nothing happening. */
let animation: { timer: Timer; ticks: number; idleTicks: number } | undefined
let isTurnRunning = false

/** How many rows of each on-screen conversation row show, by its id. */
const visibleRows = new Map<string, number>()

/** The row carrying the flock (`''` while none on screen does), and its order. */
let flockRow = { requestId: '', order: -1 }

function hashOf(text: string): number {
  let hash = 0

  for (const character of text) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }

  return hash
}

/**
 * Picks a word from the list by the engine's own sampled word, so the same
 * turn keeps the same spooky word on every redraw.
 */
function spookyWordFor(word: string, words: readonly string[]): string {
  return words[hashOf(word) % words.length] ?? word
}

/** Rows the draft takes in the prompt box: its lines, each wrapped to the box. */
function rowsOfDraft(text: string): number {
  const width = Math.max(10, promptColumns - 4)

  return text
    .split('\n')
    .reduce((rows, line) => rows + Math.max(1, Math.ceil(Array.from(line).length / width)), 0)
}

/**
 * Draws a row of cells as one Text, a nested Text per run of one color, the
 * right halves of emoji skipped.
 */
function drawCells(Text: ElementTable<'terminal'>['Text'], cells: readonly Cell[]): RenderElement {
  const runs: { color?: string; text: string }[] = []

  for (const cell of cells) {
    if (cell === null) {
      continue
    }

    const last = runs[runs.length - 1]

    if (last !== undefined && last.color === cell.color) {
      last.text += cell.glyph
    } else {
      runs.push({ color: cell.color, text: cell.glyph })
    }
  }

  const children: RenderNode[] = runs.map(run =>
    run.color === undefined ? run.text : <Text color={run.color}>{run.text}</Text>,
  )

  return <Text wrap="truncate">{children}</Text>
}

/**
 * Whether this conversation row carries the flock: the newest row on screen
 * takes it, and a row scrolled off screen lets it go to the next on-screen
 * row drawn. A row that lost it to a newer one finds out on its next tick.
 */
function carriesFlock(requestId: string, isOnScreen: boolean): boolean {
  let order = rowOrder.get(requestId)

  if (order === undefined) {
    order = rowOrder.size
    rowOrder.set(requestId, order)
  }

  if (!isOnScreen) {
    if (flockRow.requestId === requestId) {
      flockRow = { requestId: '', order: flockRow.order }
    }

    return false
  }

  if (flockRow.requestId === '' || order > flockRow.order) {
    flockRow = { requestId, order }
  }

  return flockRow.requestId === requestId
}

/**
 * Rows of conversation shown above the row carrying the flock: every
 * on-screen row's visible rows and the blank row before it. Rows the mod
 * does not hook (the logo, command records) are left out, so this errs low.
 */
function conversationRowsOnScreen(): number {
  let rows = -1

  for (const visible of visibleRows.values()) {
    rows += visible + 1
  }

  return Math.max(0, rows)
}

/**
 * Draws a conversation row and, on the row carrying it in the fullscreen
 * terminal, the flock crossing the conversation above it.
 *
 * The flock flies a sky a screen tall, its bottom on this row's bottom, and
 * only the bats over rows of conversation on screen are drawn: the terminal
 * pins anything placed past the conversation's edges to those edges, so a bat
 * there is left out until its journey brings it back over the conversation.
 */
async function withFlock($: EngineInterface, e: TranscriptSite, row: RenderElement): Promise<RenderElement> {
  const { onScreen } = e.props

  if (onScreen == null) {
    visibleRows.delete(e.requestId)
  } else {
    visibleRows.set(e.requestId, onScreen.last - onScreen.first + 1)
  }

  const isFlying = carriesFlock(e.requestId, onScreen != null)

  if (!isFlying || onScreen == null || e.surface !== 'terminal' || e.viewport?.isFullscreen !== true) {
    return row
  }

  if (!(await read($, isEnabled)) || !(await read($, isAwake))) {
    return row
  }

  const { Box, Text } = $.ui.resolve(e)
  const { columns, rows: screenRows } = e.viewport
  const skyRows = Math.max(1, screenRows - PROMPT_AREA_ROWS - (await read($, draftRows)))
  const shownRows = Math.min(skyRows, conversationRowsOnScreen())
  const skyTop = onScreen.of - skyRows
  const tick = await read($, flightTick)
  const bats = flockAt(flockSeed, columns, skyRows, tick).filter(spot => spot.y >= skyRows - shownRows)

  return (
    <Box flexDirection="column">
      {row}
      {bats.map(spot => (
        <Box position="absolute" top={skyTop + spot.y} left={spot.x}>
          <Text>{BAT}</Text>
        </Box>
      ))}
    </Box>
  )
}

/** Stops the clock and hides what moves: bats go home, the ghost leaves. */
async function sleep($: EngineInterface): Promise<void> {
  animation?.timer.cancel()
  animation = undefined
  await update($, isAwake, () => false)
}

/**
 * Something happened: keeps the clock running, or starts it again after a
 * sleep. A no-op while the theme is off.
 */
async function wake($: EngineInterface): Promise<void> {
  if (animation !== undefined) {
    animation.idleTicks = 0

    return
  }

  if (!(await read($, isEnabled))) {
    return
  }

  const clock = {
    ticks: 0,
    idleTicks: 0,
    timer: $.clock.every(ANIMATION_TICK_MS, () => {
      void advance($, clock)
    }),
  }
  animation = clock
  await update($, isAwake, () => true)
}

async function advance($: EngineInterface, clock: NonNullable<typeof animation>): Promise<void> {
  clock.idleTicks = isTurnRunning ? 0 : clock.idleTicks + 1

  if (clock.idleTicks > IDLE_TICKS) {
    await sleep($)

    return
  }

  clock.ticks++
  await update($, flightTick, tick => tick + 1)

  if (clock.ticks % TICKS_PER_FRAME_STEP === 0) {
    await update($, frameTick, tick => tick + 1)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'halloween',
      description: 'Toggle the Halloween theme (bats, pumpkins, skulls around the prompt)',
    })

    if ((await $.store.get(STORE_KEY)) === false) {
      await update($, isEnabled, () => false)
    }

    await wake($)

    return next(e)
  })

  on('command.run', { command: 'halloween' }, async $ => {
    const isNowEnabled = !(await read($, isEnabled))
    await update($, isEnabled, () => isNowEnabled)
    await $.store.set(STORE_KEY, isNowEnabled)
    await (isNowEnabled ? wake($) : sleep($))

    return {
      text: isNowEnabled
        ? '🎃 Halloween theme on. The bats are back.'
        : 'Halloween theme off. Run /halloween to bring the bats back.',
    }
  })

  on('prompt.edit', async ($, e, next) => {
    void wake($)
    const box = await next(e)
    const rows = rowsOfDraft(box.text)

    if (rows !== (await read($, draftRows))) {
      await update($, draftRows, () => rows)
    }

    return box
  })

  on('prompt.fill', async ($, e, next) => {
    void wake($)
    const filled = await next(e)
    const box = await $.prompt.read()
    await update($, draftRows, () => rowsOfDraft(box.text))

    return filled
  })

  on('prompt.submit', async ($, e, next) => {
    void wake($)
    await update($, draftRows, () => 1)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    isTurnRunning = true
    void wake($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    isTurnRunning = false
    void wake($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    void wake($)

    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!(await read($, isEnabled))) {
      return next(e)
    }

    const isFramed =
      e.surface === 'terminal' &&
      e.viewport?.isFullscreen === true &&
      e.viewport.columns >= MIN_FRAME_COLUMNS

    if (!isFramed) {
      return next({ ...e, props: { ...e.props, tail: HINT_TAIL } })
    }

    const hint = await next(e)
    const { columns } = e.viewport
    promptColumns = columns
    const rows = await read($, draftRows)
    const tick = await read($, frameTick)
    const hasGhost = await read($, isAwake)
    const { Box, Text } = $.ui.resolve(e)
    const topRuleRow = BOTTOM_RULE_ROW - rows - 1

    return (
      <Box flexDirection="column">
        {hint}
        <Box position="absolute" top={topRuleRow} left={-HINT_INDENT} width={columns}>
          {drawCells(Text, topRuleCells(frameLayout, columns, tick, hasGhost))}
        </Box>
        {Array.from({ length: rows }, (_, index) => (
          <Box position="absolute" top={BOTTOM_RULE_ROW - rows + index} left={columns - 2 - HINT_INDENT}>
            <Text>{sideGlyph(frameLayout, index)}</Text>
          </Box>
        ))}
        <Box position="absolute" top={BOTTOM_RULE_ROW} left={-HINT_INDENT} width={columns}>
          {drawCells(Text, bottomRuleCells(frameLayout, columns, tick))}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!(await read($, isEnabled))) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, SPOOKY_MODE] } })
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.message !== null || !(await read($, isEnabled))) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, word: spookyWordFor(e.props.word, SPINNER_WORDS) } })
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!(await read($, isEnabled))) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, word: spookyWordFor(e.props.word, PAST_WORDS) } })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => withFlock($, e, await next(e)))
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => withFlock($, e, await next(e)))
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => withFlock($, e, await next(e)))
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => withFlock($, e, await next(e)))
}
