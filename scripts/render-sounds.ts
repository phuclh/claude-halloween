/**
 * Renders the theme's sounds into plugins/halloween/sounds/: bat squeaks and
 * lightning cracks for typing; a villain's, a witch's and a demon's laugh, a
 * ghost, a pipe organ and a thunderclap for Enter.
 *
 * Every clip is synthesized here from oscillators, noise and filters, the
 * laughs sung by a small formant synthesizer, so the repository owns every
 * sample. Each clip has a fixed seed and writes the same bytes on every
 * render.
 *
 *   npx -p typescript tsc -p scripts
 *   node .demo-build/scripts/render-sounds.js
 */
import { BAT_CLIPS, CRACK_CLIPS, ENTER_CLIPS } from '../plugins/halloween/hooks/sounds'

declare function require(module: 'node:fs'): {
  mkdirSync: (path: string, options: { recursive: true }) => void
  writeFileSync: (path: string, data: Uint8Array) => void
}
declare const __dirname: string
declare const process: { stdout: { write: (text: string) => void } }

const PLUGIN_DIR = `${__dirname}/../../plugins/halloween`
const SAMPLE_RATE = 22_050
const TAU = Math.PI * 2

type Signal = Float32Array
type Filter = (sample: number) => number

/** Points a value passes through, at seconds: straight between them, level past the ends. */
type Curve = readonly (readonly [seconds: number, value: number])[]

const samplesIn = (seconds: number): number => Math.round(seconds * SAMPLE_RATE)

const silence = (seconds: number): Signal => new Float32Array(samplesIn(seconds))

const peakOf = (signal: Signal): number => signal.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)

/** A repeatable random source (mulberry32), so a clip's noise is the same every render. */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

function along(curve: Curve, time: number): number {
  const [firstTime, firstValue] = curve[0] ?? [0, 0]

  if (time <= firstTime) {
    return firstValue
  }

  for (let index = 1; index < curve.length; index++) {
    const [endTime, endValue] = curve[index] ?? [0, 0]

    if (time <= endTime) {
      const [startTime, startValue] = curve[index - 1] ?? [0, 0]

      return startValue + ((endValue - startValue) * (time - startTime)) / Math.max(endTime - startTime, 1e-9)
    }
  }

  return curve[curve.length - 1]?.[1] ?? 0
}

/** A second-order filter from the Audio EQ Cookbook. */
function biquad(kind: 'lowpass' | 'highpass' | 'bandpass', frequency: number, q = Math.SQRT1_2): Filter {
  const angle = (TAU * frequency) / SAMPLE_RATE
  const alpha = Math.sin(angle) / (2 * q)
  const cos = Math.cos(angle)
  const [b0, b1, b2] =
    kind === 'lowpass'
      ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
      : kind === 'highpass'
        ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
        : [alpha, 0, -alpha]
  const [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha]
  let [x1, x2, y1, y2] = [0, 0, 0, 0]

  return x => {
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    ;[x2, x1, y2, y1] = [x1, x, y1, y]

    return y
  }
}

function filtered(signal: Signal, ...filters: Filter[]): Signal {
  return signal.map(sample => filters.reduce((value, filter) => filter(value), sample))
}

function normalized(signal: Signal, peak: number): Signal {
  const scale = peak / Math.max(peakOf(signal), 1e-9)

  return signal.map(sample => sample * scale)
}

/** Adds `part` into `into` from `at` seconds on. */
function mixInto(into: Signal, part: Signal, at: number, gain = 1): void {
  const offset = samplesIn(at)

  part.forEach((sample, index) => {
    if (offset + index < into.length) {
      into[offset + index] = (into[offset + index] ?? 0) + sample * gain
    }
  })
}

/**
 * A hall around a sound: Schroeder's parallel combs and series all-passes,
 * with Freeverb's tuning at this rate. `wet` is the hall's peak against the
 * sound's own.
 */
function withReverb(dry: Signal, { room, damping, wet, tail }: { room: number; damping: number; wet: number; tail: number }): Signal {
  const length = dry.length + samplesIn(tail)
  const combs = [558, 594, 638, 678, 711, 745, 778, 808].map(size => ({ buffer: new Float32Array(size), index: 0, kept: 0 }))
  const allPasses = [278, 220, 170, 112].map(size => ({ buffer: new Float32Array(size), index: 0 }))
  const hall = new Float32Array(length)

  for (let index = 0; index < length; index++) {
    const input = (dry[index] ?? 0) * 0.015
    let sum = 0

    for (const comb of combs) {
      const echo = comb.buffer[comb.index] ?? 0
      comb.kept = echo * (1 - damping) + comb.kept * damping
      comb.buffer[comb.index] = input + comb.kept * room
      comb.index = (comb.index + 1) % comb.buffer.length
      sum += echo
    }

    for (const allPass of allPasses) {
      const echo = allPass.buffer[allPass.index] ?? 0
      allPass.buffer[allPass.index] = sum + echo * 0.5
      allPass.index = (allPass.index + 1) % allPass.buffer.length
      sum = echo - sum
    }

    hall[index] = sum
  }

  const scale = (wet * peakOf(dry)) / Math.max(peakOf(hall), 1e-9)

  return hall.map((sample, index) => (dry[index] ?? 0) + sample * scale)
}

/** Trims the quiet a clip ends in, fades its edges so it never clicks, and sets its loudness. */
function finished(signal: Signal, peak: number): Signal {
  const floor = peakOf(signal) * 0.002
  let end = signal.length

  while (end > 0 && Math.abs(signal[end - 1] ?? 0) < floor) {
    end--
  }

  const clip = signal.slice(0, end)
  const fadeIn = Math.min(samplesIn(0.001), clip.length)
  const fadeOut = Math.min(samplesIn(0.03), clip.length)

  for (let index = 0; index < fadeIn; index++) {
    clip[index] = (clip[index] ?? 0) * (index / fadeIn)
  }

  for (let index = 0; index < fadeOut; index++) {
    const at = clip.length - 1 - index
    clip[at] = (clip[at] ?? 0) * (index / fadeOut)
  }

  return normalized(clip, peak)
}

/** 16-bit mono PCM in a WAV file. */
function wavBytes(signal: Signal): Uint8Array {
  const dataBytes = signal.length * 2
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  const writeText = (offset: number, text: string) => {
    Array.from(text).forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)))
  }

  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataBytes, true)
  signal.forEach((sample, index) => {
    view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true)
  })

  return bytes
}

// Voices ---------------------------------------------------------------------

/** How a voice's pitch, voicing, breath and vocal tract move while it sings. */
type Voice = {
  seconds: number
  pitch: Curve
  /** How loud the vocal folds ring, 0 to 1. */
  voicing: Curve
  /** How much air hisses through, 0 to 1: the "h" of each "ha". */
  breath: Curve
  /** F1 to F3, the formants that make the vowel. */
  formants: readonly [Curve, Curve, Curve]
  /** F4 and F5, which barely move from vowel to vowel. */
  upperFormants: readonly [number, number]
  bandwidths: readonly [number, number, number, number, number]
  /** How closed the mouth is, 0 to 1: an "m" hums through the nose, its upper formants muffled. */
  closure: Curve
  vibrato: { rate: number; depth: Curve }
  /** How far each cycle's length strays at random, as a share of it. */
  jitter: number
  /** How much weaker every other cycle is: a growl's rough undertone an octave down. */
  growl: number
  seed: number
}

const BREATH_LEVEL = 0.35
const OPEN_QUOTIENT = 0.6

/**
 * The source of a voiced sound: the slope of the air through the vocal folds
 * as they open, then snap shut (Klatt's KLGLOTT88 pulse).
 */
function glottalSlope(phase: number): number {
  if (phase >= OPEN_QUOTIENT) {
    return 0
  }

  const opened = phase / OPEN_QUOTIENT

  return 2 * opened - 3 * opened * opened
}

/** One formant of the vocal tract: a two-pole resonance free to glide (Klatt's resonator). */
function resonator(): (sample: number, frequency: number, bandwidth: number) => number {
  let [y1, y2] = [0, 0]

  return (x, frequency, bandwidth) => {
    const radius = Math.exp((-Math.PI * bandwidth) / SAMPLE_RATE)
    const c = -radius * radius
    const b = 2 * radius * Math.cos((TAU * frequency) / SAMPLE_RATE)
    const y = (1 - b - c) * x + b * y1 + c * y2
    ;[y2, y1] = [y1, y]

    return y
  }
}

/** Sings a voice through a cascade of five formants, the way Klatt's synthesizer does. */
function sing(voice: Voice): Signal {
  const random = randomFrom(voice.seed)
  const sung = silence(voice.seconds)
  const tract = Array.from({ length: 5 }, resonator)
  const softened = biquad('lowpass', 4000)
  let phase = 0
  let cycle = 0
  let stretch = 1
  let cycleGain = 1

  for (let index = 0; index < sung.length; index++) {
    const time = index / SAMPLE_RATE
    const wobble = 1 + along(voice.vibrato.depth, time) * Math.sin(TAU * voice.vibrato.rate * time)
    phase += (along(voice.pitch, time) * wobble * stretch) / SAMPLE_RATE

    if (phase >= 1) {
      phase -= 1
      cycle++
      stretch = 1 + (random() * 2 - 1) * voice.jitter
      cycleGain = (cycle % 2 === 0 ? 1 : 1 - voice.growl) * (0.9 + random() * 0.1)
    }

    const closure = along(voice.closure, time)
    const voiced = softened(glottalSlope(phase) * cycleGain * along(voice.voicing, time))
    const breath = (random() * 2 - 1) * along(voice.breath, time) * BREATH_LEVEL
    const frequencies = [...voice.formants.map(curve => along(curve, time)), ...voice.upperFormants]
    let sample = voiced + breath

    tract.forEach((formant, number) => {
      const bandwidth = (voice.bandwidths[number] ?? 100) * (number === 0 ? 1 : 1 + closure * 4)
      sample = formant(sample, frequencies[number] ?? 1000, bandwidth)
    })

    sung[index] = sample
  }

  return filtered(sung, biquad('highpass', 70))
}

/** One beat of a laugh: a breath of "h", then a vowel sung through the pitches given. */
type Syllable = { at: number; breath: number; vowel: number; pitch: readonly number[]; loudness: number }

/**
 * The pitch, voicing and breath of a laugh: each syllable's "h" swells and
 * gives way to a vowel that rings, then dies away before the next breath.
 */
function laughCurves(syllables: readonly Syllable[], breathiness: number) {
  const pitch: [number, number][] = []
  const voicing: [number, number][] = []
  const breath: [number, number][] = []

  for (const { at, breath: hiss, vowel, pitch: pitches, loudness } of syllables) {
    const onset = at + hiss
    const end = onset + vowel

    breath.push(
      [at, 0],
      [at + hiss * 0.6, 0.5 * loudness],
      [onset, 0.4 * loudness],
      [onset + 0.02, breathiness * loudness],
      [end - 0.01, breathiness * loudness],
      [end + 0.005, 0],
    )
    voicing.push(
      [onset - 0.004, 0],
      [onset + 0.012, loudness],
      [onset + vowel * 0.4, 0.75 * loudness],
      [end - vowel * 0.15, 0.25 * loudness],
      [end, 0],
    )
    pitches.forEach((hertz, index) => {
      pitch.push([onset + (vowel * index) / Math.max(1, pitches.length - 1), hertz])
    })
  }

  return { pitch, voicing, breath }
}

/**
 * A villain's "Mwah-ha-ha-ha-haaa": a hummed "m" opening into a wide "ah",
 * four quick "ha"s falling in pitch, then a long one sinking away.
 *
 * `depth` lowers the pitch and lengthens the vocal tract, `tempo` stretches
 * the time: the demon is the villain sung deeper and slower.
 */
function mwahaha({ depth, tempo, growl, seed }: { depth: number; tempo: number; growl: number; seed: number }): Signal {
  const at = (seconds: number) => seconds * tempo
  const hertz = (pitch: number) => pitch * depth
  const tract = (frequency: number) => frequency * (0.75 + 0.25 * depth)
  const has = Array.from({ length: 4 }, (_, beat): Syllable => ({
    at: at(0.53 + beat * 0.185),
    breath: at(0.05),
    vowel: at(0.095),
    pitch: [hertz(158 - beat * 8), hertz(136 - beat * 8)],
    loudness: 0.95 - beat * 0.04,
  }))
  const last: Syllable = {
    at: at(0.53 + 4 * 0.185),
    breath: at(0.06),
    vowel: at(0.85),
    pitch: [hertz(140), hertz(148), hertz(130), hertz(108), hertz(84)],
    loudness: 1,
  }
  const laugh = laughCurves([...has, last], 0.1)
  const mwahEnd = at(0.48)
  const opened = at(0.17)

  return sing({
    seconds: last.at + last.breath + last.vowel + 0.05,
    pitch: [[0, hertz(112)], [opened, hertz(128)], [at(0.3), hertz(124)], [mwahEnd, hertz(108)], ...laugh.pitch],
    voicing: [[0, 0], [at(0.025), 0.3], [at(0.1), 0.35], [opened, 1], [at(0.3), 0.9], [mwahEnd, 0], ...laugh.voicing],
    breath: [[0, 0], [opened, 0], [at(0.2), 0.1], [at(0.46), 0.1], [mwahEnd, 0], ...laugh.breath],
    formants: [
      [[0, tract(280)], [at(0.1), tract(290)], [opened, tract(730)]],
      [[0, tract(1000)], [at(0.1), tract(760)], [opened, tract(1090)]],
      [[0, tract(2200)], [opened, tract(2440)]],
    ],
    upperFormants: [tract(3300), tract(3750)],
    bandwidths: [90, 110, 160, 250, 200],
    closure: [[0, 1], [at(0.09), 1], [at(0.15), 0]],
    vibrato: { rate: 5.2, depth: [[0, 0], [last.at + 0.15, 0], [last.at + 0.4, 0.035]] },
    jitter: 0.015,
    growl,
    seed,
  })
}

/** A witch's cackle: eight quick, raspy "heh"s climbing then falling, and a long trilling "heeeh". */
function cackle(seed: number): Signal {
  const pitches = [430, 470, 500, 495, 475, 455, 435, 415]
  const hehs = pitches.map(
    (pitch, beat): Syllable => ({
      at: 0.02 + beat * 0.125,
      breath: beat === 0 ? 0.07 : 0.035,
      vowel: 0.07,
      pitch: [pitch, pitch * 0.92],
      loudness: [0.8, 0.9, 1, 1, 0.95, 0.9, 0.85, 0.8][beat] ?? 0.8,
    }),
  )
  const last: Syllable = { at: 1.02, breath: 0.05, vowel: 0.62, pitch: [420, 445, 400, 340, 290], loudness: 1 }
  const laugh = laughCurves([...hehs, last], 0.15)

  return sing({
    seconds: 1.75,
    ...laugh,
    formants: [[[0, 640]], [[0, 2050]], [[0, 2900]]],
    upperFormants: [3900, 4500],
    bandwidths: [80, 110, 160, 220, 260],
    closure: [[0, 0]],
    vibrato: { rate: 7.5, depth: [[0, 0], [1.1, 0], [1.25, 0.05], [1.7, 0.06]] },
    jitter: 0.025,
    growl: 0.3,
    seed,
  })
}

// Things that go bump ----------------------------------------------------------

/** A ghost's "wooOOooo": a theremin gliding and wavering over a breath of wind. */
function ghost(seed: number): Signal {
  const random = randomFrom(seed)
  const pitch: Curve = [[0, 290], [0.4, 520], [0.75, 470], [1.1, 610], [1.6, 500], [2.3, 300]]
  const loudness: Curve = [[0, 0], [0.3, 0.8], [1.1, 1], [1.7, 0.7], [2.3, 0]]
  const depth: Curve = [[0, 0.005], [0.5, 0.02], [2.3, 0.03]]
  const wind = biquad('bandpass', 900, 0.8)
  const wail = silence(2.3)
  let phase = 0

  for (let index = 0; index < wail.length; index++) {
    const time = index / SAMPLE_RATE
    phase += (TAU * along(pitch, time) * (1 + along(depth, time) * Math.sin(TAU * 5.5 * time))) / SAMPLE_RATE
    const tone = Math.sin(phase) + 0.18 * Math.sin(2 * phase) + 0.07 * Math.sin(3 * phase)
    wail[index] = (tone + wind(random() * 2 - 1) * 0.6) * along(loudness, time)
  }

  return withReverb(wail, { room: 0.88, damping: 0.3, wet: 0.5, tail: 1 })
}

/** One pipe-organ note: a few ranks of pipes, slightly apart, a chiff of air as it speaks, and a tremulant. */
function organNote(frequency: number, seconds: number, random: () => number): Signal {
  const release = 0.12
  const ranks = [
    [0.5, 0.45],
    [1, 1],
    [2, 0.75],
    [3, 0.3],
    [4, 0.45],
    [6, 0.18],
    [8, 0.2],
  ] as const
  const chiff = biquad('bandpass', Math.min(frequency * 3, 9000), 3)
  const note = silence(seconds + release)

  for (let index = 0; index < note.length; index++) {
    const time = index / SAMPLE_RATE
    const swell = Math.min(1, time / 0.025) * (time > seconds ? Math.max(0, 1 - (time - seconds) / release) : 1)
    const tremulant = 1 + 0.06 * Math.sin(TAU * 6 * time)
    let sample = 0

    for (const [ratio, level] of ranks) {
      const pipe = frequency * ratio

      if (pipe < 9500) {
        sample += (level * (Math.sin(TAU * pipe * time) + Math.sin(TAU * pipe * 1.0012 * time + ratio))) / 2
      }
    }

    note[index] = sample * swell * tremulant + chiff(random() * 2 - 1) * 1.5 * Math.exp(-time / 0.03)
  }

  return note
}

/**
 * The opening of Bach's Toccata and Fugue in D minor on a pipe organ: the
 * mordent, the run down to C sharp, and a D minor chord over the pedal.
 */
function organ(seed: number): Signal {
  const random = randomFrom(seed)
  const [A4, G4, F4, E4, D4, Cs4] = [440, 392, 349.23, 329.63, 293.66, 277.18]
  const melody: [at: number, seconds: number, hertz: number][] = [
    [0, 0.08, A4],
    [0.08, 0.08, G4],
    [0.16, 0.5, A4],
    [0.78, 0.08, G4],
    [0.86, 0.08, F4],
    [0.94, 0.08, E4],
    [1.02, 0.08, D4],
    [1.1, 0.36, Cs4],
    [1.5, 0.95, D4],
  ]
  const chord = [73.42, 110, 146.83, 174.61]
  const played = silence(2.6)

  for (const [at, seconds, hertz] of melody) {
    mixInto(played, organNote(hertz, seconds, random), at)
    mixInto(played, organNote(hertz / 2, seconds, random), at, 0.8)
  }

  for (const hertz of chord) {
    mixInto(played, organNote(hertz, 0.95, random), 1.5, 0.5)
  }

  return withReverb(played, { room: 0.86, damping: 0.25, wet: 0.35, tail: 1.2 })
}

/** A strike of lightning: sparks crackling, a burst of bright noise, and a thump under them. */
function strike(
  random: () => number,
  { sparks, spread, decay, brightness, thump, seconds }: { sparks: number; spread: number; decay: number; brightness: number; thump: number; seconds: number },
): Signal {
  const crackle = silence(seconds)

  for (let spark = 0; spark < sparks; spark++) {
    const at = spread * random() ** 2
    const index = samplesIn(at)
    const size = (1 - (0.6 * at) / spread) * (random() < 0.5 ? -1 : 1)
    crackle[index] = (crackle[index] ?? 0) + size
    crackle[index + 1] = (crackle[index + 1] ?? 0) - size * 0.5
  }

  for (let index = 0; index < crackle.length; index++) {
    crackle[index] = (crackle[index] ?? 0) + (random() * 2 - 1) * 0.5 * Math.exp(-index / SAMPLE_RATE / decay)
  }

  const bright = filtered(crackle, biquad('highpass', brightness))
  const body = silence(seconds).map((_, index) => (random() * 2 - 1) * Math.exp(-index / SAMPLE_RATE / 0.05))
  mixInto(bright, normalized(filtered(body, biquad('lowpass', 180), biquad('lowpass', 180)), peakOf(bright) * thump), 0)

  return bright
}

/** A crack of lightning short enough for a keystroke. */
function crack(seed: number, { sparks, spread, echo }: { sparks: number; spread: number; echo: number }): Signal {
  const random = randomFrom(seed)
  const struck = strike(random, { sparks, spread, decay: 0.02, brightness: 1100, thump: 0.35, seconds: 0.16 })
  const cracked = silence(0.26)
  mixInto(cracked, struck, 0)
  mixInto(cracked, struck, 0.075, echo)

  return withReverb(cracked, { room: 0.6, damping: 0.4, wet: 0.15, tail: 0.15 })
}

/** A thunderclap: the strike, a flickering tear across the sky, then a rumble rolling away in waves. */
function thunder(seed: number): Signal {
  const random = randomFrom(seed)
  const seconds = 3.2
  const clap = silence(seconds)
  const rolls = [
    [0.06, 1],
    [0.45, 0.8],
    [0.95, 0.65],
    [1.5, 0.5],
    [2.1, 0.3],
  ] as const
  const fading: Curve = [[0, 1], [seconds - 0.6, 1], [seconds, 0]]
  const roll = (time: number) =>
    along(fading, time) *
    rolls.reduce((sum, [at, size]) => (time < at ? sum : sum + size * (1 - Math.exp(-(time - at) / 0.08)) * Math.exp(-(time - at) / 0.5)), 0)
  const rumble = filtered(
    silence(seconds).map((_, index) => (random() * 2 - 1) * roll(index / SAMPLE_RATE)),
    biquad('lowpass', 260, 0.8),
    biquad('lowpass', 260, 0.8),
    biquad('highpass', 35),
  )
  let flicker = 1
  const tear = filtered(
    silence(seconds).map((_, index) => {
      if (index % samplesIn(0.008) === 0) {
        flicker = random() < 0.3 ? 1 : 0.25
      }

      return (random() * 2 - 1) * flicker * Math.exp(-index / SAMPLE_RATE / 0.35)
    }),
    biquad('bandpass', 1200, 0.7),
  )
  const struck = strike(random, { sparks: 16, spread: 0.09, decay: 0.07, brightness: 700, thump: 0.6, seconds: 0.5 })

  mixInto(clap, normalized(rumble, 1), 0)
  mixInto(clap, normalized(tear, 0.35), 0.02)
  mixInto(clap, normalized(struck, 0.7), 0)

  return withReverb(clap, { room: 0.8, damping: 0.5, wet: 0.2, tail: 0.6 })
}

/** One bat call: a quick squeak sweeping down in pitch, rasping as it goes. */
type Chirp = { at: number; seconds: number; from: number; to: number }

function batSqueak(seed: number, chirps: readonly Chirp[]): Signal {
  const random = randomFrom(seed)
  const squeak = silence(Math.max(...chirps.map(chirp => chirp.at + chirp.seconds)) + 0.02)

  for (const { at, seconds, from, to } of chirps) {
    const length = samplesIn(seconds)
    const offset = samplesIn(at)
    let phase = 0

    for (let index = 0; index < length; index++) {
      const time = index / SAMPLE_RATE
      const progress = index / length
      const pitch = from * (to / from) ** progress * (1 + 0.05 * Math.sin(TAU * 380 * time))
      phase += (TAU * pitch) / SAMPLE_RATE
      const envelope = Math.min(1, time / 0.002) * (1 - progress) ** 1.5
      const overtone = 0.25 * Math.max(0, Math.min(1, (10_000 - 2 * pitch) / 1500)) * Math.sin(2 * phase)
      squeak[offset + index] = (squeak[offset + index] ?? 0) + envelope * (Math.sin(phase) + overtone + (random() * 2 - 1) * 0.04)
    }
  }

  return squeak
}

const RECIPES: Record<string, () => Signal> = {
  'sounds/bat-1.wav': () =>
    finished(
      batSqueak(11, [
        { at: 0, seconds: 0.024, from: 6800, to: 3600 },
        { at: 0.055, seconds: 0.022, from: 6400, to: 3400 },
      ]),
      0.25,
    ),
  'sounds/bat-2.wav': () =>
    finished(
      batSqueak(12, [
        { at: 0, seconds: 0.016, from: 5800, to: 3200 },
        { at: 0.038, seconds: 0.016, from: 6000, to: 3300 },
        { at: 0.076, seconds: 0.018, from: 5600, to: 3000 },
      ]),
      0.25,
    ),
  'sounds/bat-3.wav': () => finished(batSqueak(13, [{ at: 0, seconds: 0.04, from: 7200, to: 4200 }]), 0.25),
  'sounds/bat-4.wav': () =>
    finished(
      batSqueak(14, [
        { at: 0, seconds: 0.022, from: 6200, to: 3000 },
        { at: 0.05, seconds: 0.03, from: 7000, to: 3800 },
      ]),
      0.25,
    ),
  'sounds/crack-1.wav': () => finished(crack(21, { sparks: 6, spread: 0.025, echo: 0 }), 0.45),
  'sounds/crack-2.wav': () => finished(crack(22, { sparks: 9, spread: 0.035, echo: 0.3 }), 0.45),
  'sounds/laugh-villain.wav': () =>
    finished(withReverb(mwahaha({ depth: 1, tempo: 1, growl: 0.25, seed: 31 }), { room: 0.72, damping: 0.45, wet: 0.18, tail: 0.6 }), 0.62),
  'sounds/laugh-witch.wav': () => finished(withReverb(cackle(32), { room: 0.7, damping: 0.45, wet: 0.16, tail: 0.5 }), 0.59),
  'sounds/laugh-demon.wav': () =>
    finished(withReverb(mwahaha({ depth: 0.62, tempo: 1.25, growl: 0.5, seed: 33 }), { room: 0.84, damping: 0.4, wet: 0.3, tail: 1 }), 0.9),
  'sounds/ghost.wav': () => finished(ghost(41), 0.35),
  'sounds/organ.wav': () => finished(organ(42), 0.55),
  'sounds/thunder.wav': () => finished(thunder(43), 0.76),
}

const fs = require('node:fs')
fs.mkdirSync(`${PLUGIN_DIR}/sounds`, { recursive: true })

for (const clip of [...BAT_CLIPS, ...CRACK_CLIPS, ...ENTER_CLIPS]) {
  const recipe = RECIPES[clip]

  if (recipe === undefined) {
    throw new Error(`No recipe renders ${clip}`)
  }

  const signal = recipe()
  fs.writeFileSync(`${PLUGIN_DIR}/${clip}`, wavBytes(signal))
  process.stdout.write(`${clip}  ${(signal.length / SAMPLE_RATE).toFixed(2)}s\n`)
}
