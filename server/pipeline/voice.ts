import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ROOT, type SosieConfig } from '../config.ts'
import { pickFreeGpu } from '../gpus.ts'
import { runPy } from '../py.ts'
import { probeDuration } from '../media/ffmpeg.ts'
import { shiftWords, type Word } from './captions.ts'
import { spokenText } from './script.ts'

const run = promisify(execFile)

export type Voice = {
  id: string
  name: string
  kind: 'clone' | 'designed'
  /** For designed voices: the description they were made from. */
  description?: string
  /** "This is me, or I have this person's permission." Required for cloned voices. */
  consent: boolean
  createdAt: string
}

/** One line of the script: what is said, its delivery note, and optional pace (1 = natural) and pause after it (s). */
export type ScriptLine = { text: string; direction?: string; pace?: number; pause?: number }

/** Breeze TTS 2 follows delivery notes and vocal events; Dots TTS clones the cleanest (docs/VOICE_PROMPTING.md). */
export type VoiceEngine = 'breeze' | 'dots'
export const VOICE_ENGINES: VoiceEngine[] = ['breeze', 'dots']

export type SpokenLine = ScriptLine & { file: string; durationS: number; startS: number }

export type VoiceTrack = {
  wav: string
  durationS: number
  sampleRate: number
  lines: SpokenLine[]
  words: Word[]
}

const VOICE_SAMPLE_TEXT = 'Hi, this is how I sound when I explain something I find really interesting. Let me show you how it works.'

export function voicesDir(root = ROOT) {
  return join(root, 'data', 'voices')
}

export function listVoices(root = ROOT): Voice[] {
  const dir = voicesDir(root)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((id) => join(dir, id, 'voice.json'))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')) as Voice)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function voiceFiles(id: string, root = ROOT) {
  const dir = join(voicesDir(root), id)
  // ref.wav is 24 kHz for Breeze; ref-hq.wav keeps 48 kHz for Dots, which copies the reference's sound
  return { dir, meta: join(dir, 'voice.json'), wav: join(dir, 'ref.wav'), hq: join(dir, 'ref-hq.wav'), text: join(dir, 'ref.txt') }
}

/** Mono WAV: 24 kHz is the rate Breeze works at; Dots works at 48 kHz. */
async function toVoiceWav(src: string, dst: string, maxSeconds = 20, rate = 24000) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-t', String(maxSeconds), '-ac', '1', '-ar', String(rate), '-c:a', 'pcm_s16le', dst])
}

/** Add a cloned voice from a sample (5–20 s) and its exact transcript. */
export async function importVoice(input: { name: string; sample: string; transcript: string; consent: boolean }, root = ROOT): Promise<Voice> {
  if (!input.consent) throw new Error('Confirm this is your voice, or that you have permission to clone it.')
  const transcript = input.transcript.trim()
  if (!transcript) throw new Error('A cloned voice needs the exact words spoken in the sample.')
  const voice: Voice = { id: randomUUID(), name: input.name.trim() || 'Voice', kind: 'clone', consent: true, createdAt: new Date().toISOString() }
  const files = voiceFiles(voice.id, root)
  mkdirSync(files.dir, { recursive: true })
  await toVoiceWav(input.sample, files.wav)
  await toVoiceWav(input.sample, files.hq, 20, 48000)
  const seconds = await probeDuration(files.wav)
  if (seconds < 3) throw new Error(`The sample is ${seconds.toFixed(1)} s; use 5–20 s of clear speech.`)
  writeFileSync(files.text, transcript)
  writeFileSync(files.meta, JSON.stringify(voice, null, 1))
  return voice
}

/** Make a designed voice: Breeze voices a sample sentence from the description; later lines clone that sample. */
export async function designVoice(config: SosieConfig, input: { name: string; description: string; seed?: number }, root = ROOT): Promise<Voice> {
  const description = input.description.trim()
  if (!description) throw new Error('Describe the voice, e.g. "a warm, calm woman in her forties".')
  const voice: Voice = { id: randomUUID(), name: input.name.trim() || 'Designed voice', kind: 'designed', description, consent: true, createdAt: new Date().toISOString() }
  const files = voiceFiles(voice.id, root)
  const work = join(files.dir, 'design')
  const gpu = await pickFreeGpu(config.gpus.tts, config.gpus.ttsMinFreeGb * 1024)
  await runPy('tts', {
    model: config.paths.breezeModel, out: work, seed: input.seed ?? 42,
    voice: { mode: 'design', instruction: description },
    lines: [{ text: VOICE_SAMPLE_TEXT }],
  }, { gpu: gpu.index, workDir: work })
  copyFileSync(join(work, '01.wav'), files.wav)
  writeFileSync(files.text, VOICE_SAMPLE_TEXT)
  writeFileSync(files.meta, JSON.stringify(voice, null, 1))
  return voice
}

export function lineKey(voiceId: string, refHash: string, line: ScriptLine, seed: number, engine: VoiceEngine = 'breeze'): string {
  // Dots takes no delivery note and speaks only the words, so its key ignores both
  const parts = engine === 'dots' ? ['dots', spokenText(line.text)] : [line.text.trim(), (line.direction ?? '').trim()]
  return createHash('sha256').update(JSON.stringify([voiceId, refHash, ...parts, seed])).digest('hex').slice(0, 24)
}

/** The engine's sample rate: the joined track keeps it (Dots stays 48 kHz all the way to the video). */
export function engineRate(engine: VoiceEngine): number {
  return engine === 'dots' ? 48000 : 24000
}

/** The Python environment and model a Dots job needs; null when they are in place. */
export function dotsMissing(config: SosieConfig, root = ROOT): string | null {
  if (!config.paths.dotsModel) return 'Dots TTS is not set up: paths.dotsModel is empty in config/sosie.local.json.'
  if (!existsSync(join(config.paths.dotsModel, 'model.safetensors'))) return `Dots TTS model not found in ${config.paths.dotsModel}.`
  if (!existsSync(join(root, 'py', 'dots-tts', '.venv', 'bin', 'python'))) return 'Dots TTS is not installed (py/dots-tts/.venv).'
  return null
}

/** Default pause after a line (the gap after its trimmed speech): longer after a full stop. */
export function pauseAfter(text: string): number {
  return /[.!?…]["')\]]*\s*$/.test(text.trim()) ? 0.5 : 0.3
}

/** Line `i` followed by `pause` seconds of silence. apad without a positive duration pads forever (it once filled
 * the disk), so a zero pause passes the line through unchanged. */
export function gapFilter(i: number, pause: number): string {
  return pause > 0 ? `[${i}:a]apad=pad_dur=${pause}[a${i}]` : `[${i}:a]anull[a${i}]`
}

/** Cut the silence the engines leave around a line (Dots up to 0.9 s), keeping 50 ms, so `pause` is the real gap. */
export const TRIM_SILENCE = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse'

/**
 * Voice every line (cached) with the chosen engine, apply each line's pace, join them with their pauses,
 * normalise loudness once on the joined track, and align words. Returns the joined track and each line's place on it.
 */
export async function speakScript(config: SosieConfig, voiceId: string, lines: ScriptLine[], workDir: string, opts: { seed?: number; engine?: VoiceEngine; onProgress?: (done: number, total: number) => void } = {}, root = ROOT): Promise<VoiceTrack> {
  const seed = opts.seed ?? 42
  const engine = opts.engine ?? 'breeze'
  const rate = engineRate(engine)
  const files = voiceFiles(voiceId, root)
  if (!existsSync(files.meta)) throw new Error('That voice no longer exists.')
  if (engine === 'dots') {
    const missing = dotsMissing(config, root)
    if (missing) throw new Error(missing)
  }
  // Dots copies the reference's sound, so it gets the 48 kHz copy when the voice has one
  const refAudio = engine === 'dots' && existsSync(files.hq) ? files.hq : files.wav
  const refHash = createHash('sha256').update(readFileSync(refAudio)).digest('hex')
  const cacheDir = join(root, 'data', 'cache', 'tts')
  mkdirSync(cacheDir, { recursive: true })
  mkdirSync(workDir, { recursive: true })

  const keys = lines.map((line) => lineKey(voiceId, refHash, line, seed, engine))
  const missing = lines.map((line, i) => ({ line, key: keys[i] })).filter(({ key }) => !existsSync(join(cacheDir, `${key}.wav`)))
  if (missing.length) {
    const gpu = await pickFreeGpu(config.gpus.tts, config.gpus.ttsMinFreeGb * 1024)
    const out = join(workDir, 'tts')
    let done = lines.length - missing.length
    const onLine = (text: string) => { if (text.startsWith('{"line"')) opts.onProgress?.(++done, lines.length) }
    const refText = readFileSync(files.text, 'utf8').trim()
    if (engine === 'dots') {
      await runPy('dots', {
        model: config.paths.dotsModel, out, seed, steps: 15, cfg: 1.2, refAudio, refText,
        lines: missing.map(({ line }) => ({ text: spokenText(line.text) })),
      }, { gpu: gpu.index, workDir: out, onLine })
    } else {
      await runPy('tts', {
        model: config.paths.breezeModel, out, seed,
        voice: { mode: 'clone', refAudio, refText },
        lines: missing.map(({ line }) => ({ text: line.text, direction: line.direction ?? '' })),
      }, { gpu: gpu.index, workDir: out, onLine })
    }
    missing.forEach(({ key }, i) => copyFileSync(join(out, `${String(i + 1).padStart(2, '0')}.wav`), join(cacheDir, `${key}.wav`)))
  }

  // each line trimmed to its speech, at the track's rate, with its pace (a pitch-preserving stretch); then line, pause, line …
  const spoken: SpokenLine[] = []
  let cursor = 0
  const inputs: string[] = []
  const filters: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const file = join(workDir, `line-${String(i + 1).padStart(2, '0')}.wav`)
    const pace = lines[i].pace ?? 1
    const stretch = pace !== 1 ? `,rubberband=tempo=${pace}:formant=preserved:pitchq=quality` : ''
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(cacheDir, `${keys[i]}.wav`), '-af',
      `aresample=${rate},aformat=channel_layouts=mono,${TRIM_SILENCE}${stretch}`, '-c:a', 'pcm_s16le', file])
    const durationS = await probeDuration(file)
    spoken.push({ ...lines[i], file, durationS, startS: +cursor.toFixed(6) })
    inputs.push('-i', file)
    const pause = lines[i].pause ?? (i < lines.length - 1 ? pauseAfter(lines[i].text) : 0.3)
    filters.push(gapFilter(i, pause))
    cursor += durationS + pause
  }
  const raw = join(workDir, 'voice-raw.wav')
  const graph = `${filters.join(';')};${lines.map((_, i) => `[a${i}]`).join('')}concat=n=${lines.length}:v=0:a=1[out]`
  // the length is known: cap the output so a filter mistake can never write an endless file
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', graph, '-map', '[out]', '-t', (cursor + 1).toFixed(3), '-c:a', 'pcm_s16le', raw], { maxBuffer: 16 * 1024 * 1024 })

  // loudness: two-pass loudnorm to −16 LUFS, once, on the joined track
  const wav = join(workDir, 'voice.wav')
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { maxBuffer: 16 * 1024 * 1024 })
  const measured = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1)) as Record<string, string>
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af',
    `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true,aresample=${rate}`,
    '-ac', '1', '-c:a', 'pcm_s16le', wav])

  // words: align each line on its own clip (short and exact, events removed), then shift onto the joined timeline
  const words: Word[] = []
  for (let i = 0; i < spoken.length; i++) {
    const out = join(workDir, `words-${String(i + 1).padStart(2, '0')}.json`)
    await runPy('align', { model: config.paths.whisperModel, wav: spoken[i].file, text: spokenText(spoken[i].text), out }, { gpu: null, workDir })
    words.push(...shiftWords(JSON.parse(readFileSync(out, 'utf8')) as Word[], spoken[i].startS))
  }
  const durationS = await probeDuration(wav)
  return { wav, durationS, sampleRate: rate, lines: spoken, words }
}
