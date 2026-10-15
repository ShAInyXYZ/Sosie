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

export type ScriptLine = { text: string; direction?: string }

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
  return { dir, meta: join(dir, 'voice.json'), wav: join(dir, 'ref.wav'), text: join(dir, 'ref.txt') }
}

/** Mono 24 kHz WAV, the rate Breeze works at. */
async function toVoiceWav(src: string, dst: string, maxSeconds = 20) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-t', String(maxSeconds), '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', dst])
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

export function lineKey(voiceId: string, refHash: string, line: ScriptLine, seed: number): string {
  return createHash('sha256').update(JSON.stringify([voiceId, refHash, line.text.trim(), (line.direction ?? '').trim(), seed])).digest('hex').slice(0, 24)
}

/** Pause after a line: longer after a full stop. */
export function pauseAfter(text: string): number {
  return /[.!?…]["')\]]*\s*$/.test(text.trim()) ? 0.4 : 0.25
}

/**
 * Voice every line (cached), join them with natural pauses, normalise loudness once on the joined
 * track, and align words. Returns the joined track and each line's place on it.
 */
export async function speakScript(config: SosieConfig, voiceId: string, lines: ScriptLine[], workDir: string, opts: { seed?: number; onProgress?: (done: number, total: number) => void } = {}, root = ROOT): Promise<VoiceTrack> {
  const seed = opts.seed ?? 42
  const files = voiceFiles(voiceId, root)
  if (!existsSync(files.meta)) throw new Error('That voice no longer exists.')
  const refHash = createHash('sha256').update(readFileSync(files.wav)).digest('hex')
  const cacheDir = join(root, 'data', 'cache', 'tts')
  mkdirSync(cacheDir, { recursive: true })
  mkdirSync(workDir, { recursive: true })

  const keys = lines.map((line) => lineKey(voiceId, refHash, line, seed))
  const missing = lines.map((line, i) => ({ line, key: keys[i] })).filter(({ key }) => !existsSync(join(cacheDir, `${key}.wav`)))
  if (missing.length) {
    const gpu = await pickFreeGpu(config.gpus.tts, config.gpus.ttsMinFreeGb * 1024)
    const out = join(workDir, 'tts')
    let done = lines.length - missing.length
    await runPy('tts', {
      model: config.paths.breezeModel, out, seed,
      voice: { mode: 'clone', refAudio: files.wav, refText: readFileSync(files.text, 'utf8').trim() },
      lines: missing.map(({ line }) => ({ text: line.text, direction: line.direction ?? '' })),
    }, { gpu: gpu.index, workDir: out, onLine: (text) => { if (text.startsWith('{"line"')) opts.onProgress?.(++done, lines.length) } })
    missing.forEach(({ key }, i) => copyFileSync(join(out, `${String(i + 1).padStart(2, '0')}.wav`), join(cacheDir, `${key}.wav`)))
  }

  // join: line, pause, line, pause … (sample-accurate concat via the concat filter)
  const spoken: SpokenLine[] = []
  let cursor = 0
  const inputs: string[] = []
  const filters: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const file = join(cacheDir, `${keys[i]}.wav`)
    const durationS = await probeDuration(file)
    spoken.push({ ...lines[i], file, durationS, startS: +cursor.toFixed(6) })
    inputs.push('-i', file)
    const pause = i < lines.length - 1 ? pauseAfter(lines[i].text) : 0.3
    filters.push(`[${i}:a]aresample=24000,aformat=channel_layouts=mono,apad=pad_dur=${pause}[a${i}]`)
    cursor += durationS + pause
  }
  const raw = join(workDir, 'voice-raw.wav')
  const graph = `${filters.join(';')};${lines.map((_, i) => `[a${i}]`).join('')}concat=n=${lines.length}:v=0:a=1[out]`
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', graph, '-map', '[out]', '-c:a', 'pcm_s16le', raw], { maxBuffer: 16 * 1024 * 1024 })

  // loudness: two-pass loudnorm to −16 LUFS, once, on the joined track
  const wav = join(workDir, 'voice.wav')
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { maxBuffer: 16 * 1024 * 1024 })
  const measured = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1)) as Record<string, string>
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af',
    `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true,aresample=24000`,
    '-ac', '1', '-c:a', 'pcm_s16le', wav])

  // words: align each line on its own clip (short and exact), then shift onto the joined timeline
  const words: Word[] = []
  for (let i = 0; i < spoken.length; i++) {
    const out = join(workDir, `words-${String(i + 1).padStart(2, '0')}.json`)
    await runPy('align', { model: config.paths.whisperModel, wav: spoken[i].file, text: spoken[i].text, out }, { gpu: null, workDir })
    words.push(...shiftWords(JSON.parse(readFileSync(out, 'utf8')) as Word[], spoken[i].startS))
  }
  const durationS = await probeDuration(wav)
  return { wav, durationS, sampleRate: 24000, lines: spoken, words }
}
