import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderElement, RenderInput, RenderNode, Timer } from 'claude-code'

import { flockAt } from './bats'
import { bottomRuleCells, createFrameLayout, sideGlyph, topRuleCells } from './frame'
import type { Cell } from './frame'
import { createEnterDeck, keystrokeClip } from './sounds'

const isEnabled = atom({ plugin: 'halloween', key: 'isEnabled' } as const, true)
const hasSounds = atom({ plugin: 'halloween', key: 'hasSounds' } as const, false)
const draftRows = atom({ plugin: 'halloween', key: 'draftRows' } as const, 1)
const frameTick = atom({ plugin: 'halloween', key: 'frameTick' } as const, 0)
const flightTick = atom({ plugin: 'halloween', key: 'flightTick' } as const, 0)
const isAwake = atom({ plugin: 'halloween', key: 'isAwake' } as const, false)
const isSelecting = atom({ plugin: 'halloween', key: 'isSelecting' } as const, false)

const STORE_KEY = 'isEnabled'
const SOUNDS_STORE_KEY = 'hasSounds'
const SOUNDS_ARGUMENT = 'sounds'
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
 * Where the prompt box sits relative to the footer's mode labels, which the
 * terminal keeps right-aligned on the first row under the box whatever else
 * the footer holds (a status line or none): the bottom rule is the row above
 * them, the draft rows above it, then the top rule. The labels end this many
 * columns short of the right edge.
 */
const MODES_RIGHT_MARGIN = 2
const BOTTOM_RULE_ROW = -1

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

/** When the last keystroke sound played, in the clock's milliseconds. */
let lastKeystrokeAt = Number.NEGATIVE_INFINITY

/** Deals the next Enter sound, and stops the one still playing when it does. */
const nextEnterClip = createEnterDeck()
let enterClip: AbortController | undefined

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

/** Whether the frame is drawn here: the fullscreen terminal, wide enough for it. */
function isFramed(e: { surface: string; viewport?: { columns: number; isFullscreen?: boolean } }): e is {
  surface: 'terminal'
  viewport: { columns: number; isFullscreen: true }
} {
  return e.surface === 'terminal' && e.viewport?.isFullscreen === true && e.viewport.columns >= MIN_FRAME_COLUMNS
}

/** Cells a label takes in the terminal: two for an emoji, one for the rest. */
function widthOf(text: string): number {
  return Array.from(text).reduce((cells, character) => cells + ((character.codePointAt(0) ?? 0) > 0xffff ? 2 : 1), 0)
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
 *
 * The flock lands while text is selected: a mouse copy takes the cells on
 * screen, so a bat over the selection would be copied in place of the text
 * under it.
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

  if (!(await read($, isEnabled)) || !(await read($, isAwake)) || (await read($, isSelecting))) {
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

/**
 * Lands the flock while the person has text selected, and lets it fly again
 * once nothing is. The engine reports a selection while the mouse still drags,
 * so the bats are gone before the copy on release reads the screen. A surface
 * that cannot say counts as no selection.
 */
async function checkSelection($: EngineInterface): Promise<void> {
  const hasSelection = (await $.ui.selection().catch(() => undefined)) !== undefined

  if (hasSelection !== (await read($, isSelecting))) {
    await update($, isSelecting, () => hasSelection)
  }
}

async function advance($: EngineInterface, clock: NonNullable<typeof animation>): Promise<void> {
  clock.idleTicks = isTurnRunning ? 0 : clock.idleTicks + 1

  if (clock.idleTicks > IDLE_TICKS) {
    await sleep($)

    return
  }

  await checkSelection($)
  clock.ticks++
  await update($, flightTick, tick => tick + 1)

  if (clock.ticks % TICKS_PER_FRAME_STEP === 0) {
    await update($, frameTick, tick => tick + 1)
  }
}

async function isSounding($: EngineInterface): Promise<boolean> {
  return (await read($, hasSounds)) && (await read($, isEnabled))
}

/**
 * Plays one of the plugin's clips without holding up the hook that asked; a
 * terminal with no player plays nothing.
 */
function play($: EngineInterface, asset: string, signal?: AbortSignal): void {
  $.audio.play({ asset }, signal === undefined ? undefined : { signal }).catch(() => undefined)
}

/** A bat squeaks or lightning cracks for an edit the person typed. */
async function soundKeystroke($: EngineInterface, edit: { start: number; end: number; inputText: string }): Promise<void> {
  if (!(await isSounding($))) {
    return
  }

  const now = await $.clock.now()
  const clip = keystrokeClip(edit, now - lastKeystrokeAt)

  if (clip !== undefined) {
    lastKeystrokeAt = now
    play($, clip)
  }
}

/** The next laugh, wail, organ or thunder in the deck, cutting off the last one. */
function soundEnter($: EngineInterface): void {
  enterClip?.abort()
  enterClip = new AbortController()
  play($, nextEnterClip(), enterClip.signal)
}

async function toggleSounds($: EngineInterface): Promise<{ text: string }> {
  const isNowOn = !(await read($, hasSounds))
  await update($, hasSounds, () => isNowOn)
  await $.store.set(SOUNDS_STORE_KEY, isNowOn)

  if (!isNowOn) {
    enterClip?.abort()

    return { text: 'Spooky sounds off. Run /halloween sounds to bring them back.' }
  }

  const isThemeComingBack = !(await read($, isEnabled))

  if (isThemeComingBack) {
    await setTheme($, true)
  }

  soundEnter($)

  return {
    text: `🔊 Spooky sounds on${isThemeComingBack ? ', and the Halloween theme with them' : ''}. Bats squeak and lightning cracks as you type, and Enter gets a cackle. Sounds play on macOS.`,
  }
}

/** Turns the theme on or off and remembers it; off, the bats go home and any sound stops. */
async function setTheme($: EngineInterface, isOn: boolean): Promise<void> {
  await update($, isEnabled, () => isOn)
  await $.store.set(STORE_KEY, isOn)

  if (isOn) {
    await wake($)

    return
  }

  enterClip?.abort()
  await sleep($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'halloween',
      description: 'Toggle the Halloween theme (bats, pumpkins, skulls around the prompt); "sounds" toggles its sounds',
      argumentHint: '[sounds]',
    })

    if ((await $.store.get(STORE_KEY)) === false) {
      await update($, isEnabled, () => false)
    }

    if ((await $.store.get(SOUNDS_STORE_KEY)) === true) {
      await update($, hasSounds, () => true)
    }

    await wake($)

    return next(e)
  })

  on('command.run', { command: 'halloween' }, async ($, e) => {
    const option = e.args.trim()

    if (option.toLowerCase() === SOUNDS_ARGUMENT) {
      return toggleSounds($)
    }

    if (option !== '') {
      return {
        text: `No option "${option}": run /halloween to turn the theme on or off, or /halloween sounds for its sounds.`,
      }
    }

    const isNowEnabled = !(await read($, isEnabled))
    await setTheme($, isNowEnabled)

    if (!isNowEnabled) {
      return { text: 'Halloween theme off. Run /halloween to bring the bats back.' }
    }

    return {
      text: (await read($, hasSounds))
        ? '🎃 Halloween theme on. The bats are back.'
        : '🎃 Halloween theme on. The bats are back. Try /halloween sounds for spooky sounds.',
    }
  })

  on('prompt.edit', async ($, e, next) => {
    void wake($)
    void soundKeystroke($, e)
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

    if (e.origin.kind === 'composer' && (await isSounding($))) {
      soundEnter($)
    }

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
    if (!(await read($, isEnabled)) || isFramed(e)) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, tail: HINT_TAIL } })
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!(await read($, isEnabled))) {
      return next(e)
    }

    const modes = [...e.props.modes, SPOOKY_MODE]
    const labels = await next({ ...e, props: { ...e.props, modes } })

    if (!isFramed(e)) {
      return labels
    }

    const { columns } = e.viewport
    promptColumns = columns
    const rows = await read($, draftRows)
    const tick = await read($, frameTick)
    const hasGhost = await read($, isAwake)
    const { Box, Text } = $.ui.resolve(e)
    const siteLeft = columns - MODES_RIGHT_MARGIN - widthOf(modes.join(' & '))
    const topRuleRow = BOTTOM_RULE_ROW - rows - 1

    return (
      <Box flexDirection="column">
        {labels}
        <Box position="absolute" top={topRuleRow} left={-siteLeft} width={columns}>
          {drawCells(Text, topRuleCells(frameLayout, columns, tick, hasGhost))}
        </Box>
        {Array.from({ length: rows }, (_, index) => (
          <Box position="absolute" top={BOTTOM_RULE_ROW - rows + index} left={columns - 2 - siteLeft}>
            <Text>{sideGlyph(frameLayout, index)}</Text>
          </Box>
        ))}
        <Box position="absolute" top={BOTTOM_RULE_ROW} left={-siteLeft} width={columns}>
          {drawCells(Text, bottomRuleCells(frameLayout, columns, tick))}
        </Box>
      </Box>
    )
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
