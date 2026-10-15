import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ComfyClient } from '../comfy/client.ts'
import { ROOT, type SosieConfig } from '../config.ts'
import { readGpus } from '../system.ts'
import { cutAudio, referenceAudio, trimAndMux } from '../media/ffmpeg.ts'
import { runPy } from '../py.ts'
import { captionLines, toSrt, type Word } from './captions.ts'
import { getFace, faceFiles } from './faces.ts'
import { FORMATS, H3_MODELS, SPEED_LORAS, h3VramNeeds, talkGraph, type Format, type SpeedLora } from './h3.ts'
import { planSegments, type Segment } from './plan.ts'
import { qcReportHtml } from './qc-report.ts'
import { talkPrompt } from './prompt.ts'
import { FPS, framesFor } from './segments.ts'
import { listVoices, speakScript, type ScriptLine, type SpokenLine } from './voice.ts'

const run = promisify(execFile)

export type JobSpec = {
  id: string
  name: string
  script: ScriptLine[]
  voiceId: string
  faceId: string
  format: Format
  lora: SpeedLora
  seed: number
  punchIn: boolean
  /** "Try first segment": voice the whole script, render segment 1 only. */
  firstSegmentOnly?: boolean
  /** Advanced settings (Studio → Settings): see talkGraph. */
  steps?: number
  size?: { width: number; height: number }
  refImageSize?: 'match' | 'max'
}

export type QcReport = { pass: boolean; [key: string]: unknown }
export type Attempt = { seed: number; seconds: number; qc: QcReport; file: string }
export type SegmentState = Segment & { status: 'pending' | 'done' | 'flagged'; attempts: Attempt[]; file?: string; seedBase: number }

export type JobStep = 'voice' | 'plan' | 'face' | 'h3' | 'join' | 'bundle' | 'done'

export type JobState = {
  spec: JobSpec
  status: 'queued' | 'running' | 'done' | 'failed' | 'canceled'
  step: JobStep
  progress: number
  message: string
  voice?: { wav: string; durationS: number; words: Word[]; lines: SpokenLine[] }
  segments: SegmentState[]
  outputs?: { dir: string; video: string; captions: string; words: string; project: string; poster: string; qcJson?: string; qcHtml?: string }
  error?: string
  timings: Record<string, number>
  createdAt: string
  updatedAt: string
}

export const MAX_ATTEMPTS = 2

export function projectDir(id: string, root = ROOT) {
  return join(root, 'data', 'projects', id)
}

export function loadJob(id: string, root = ROOT): JobState | null {
  const file = join(projectDir(id, root), 'job.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as JobState) : null
}

function saveJob(state: JobState, root = ROOT) {
  state.updatedAt = new Date().toISOString()
  mkdirSync(projectDir(state.spec.id, root), { recursive: true })
  writeFileSync(join(projectDir(state.spec.id, root), 'job.json'), JSON.stringify(state, null, 1))
}

export function newJob(spec: JobSpec): JobState {
  const now = new Date().toISOString()
  return { spec, status: 'queued', step: 'voice', progress: 0, message: 'Queued', segments: [], timings: {}, createdAt: now, updatedAt: now }
}

function slug(name: string, id: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return base || `facecam-${id.slice(0, 8)}`
}

/** Mark one segment for another take with a new seed; the next run renders it, then joins again. */
export function rerollSegment(id: string, index: number, root = ROOT): JobState {
  const state = loadJob(id, root)
  if (!state) throw new Error('Job not found')
  const segment = state.segments[index]
  if (!segment) throw new Error(`No segment ${index + 1}`)
  segment.status = 'pending'
  segment.seedBase += 7919
  state.status = 'queued'
  state.step = 'h3'
  state.outputs = undefined
  saveJob(state, root)
  return state
}

/**
 * Score every take of a job again with the current QC (no filming), keep the best passing take per
 * segment, and mark the job for a new join and bundle. Used after the QC itself changed.
 */
export async function rescoreJob(id: string, engines: Pick<Engines, 'qc'>, root = ROOT): Promise<JobState> {
  const state = loadJob(id, root)
  if (!state) throw new Error('Job not found')
  const segDir = join(projectDir(id, root), 'segments')
  for (const segment of state.segments) {
    const tag = `seg-${String(segment.index + 1).padStart(2, '0')}`
    for (const attempt of segment.attempts) {
      attempt.qc = await engines.qc({ video: attempt.file, audio: join(segDir, `${tag}-voice.wav`), frames: segment.frames, out: attempt.file.replace(/\.mp4$/, '-qc.json'), words: segment.words, workDir: segDir })
    }
    const passing = segment.attempts.filter((a) => a.qc.pass)
    const pool = passing.length ? passing : segment.attempts
    const best = [...pool].sort((a, b) => syncConfidence(b.qc) - syncConfidence(a.qc))[0]
    if (best) {
      segment.file = best.file
      segment.status = passing.length ? 'done' : 'flagged'
    }
  }
  state.status = 'queued'
  state.step = 'join'
  state.outputs = undefined
  saveJob(state, root)
  return state
}

async function assertVram(config: SosieConfig) {
  const gpus = await readGpus()
  if (!gpus) return // unknown: let ComfyUI try
  const short = Object.entries(h3VramNeeds(config))
    .map(([gpu, need]) => ({ gpu: Number(gpu), need, free: gpus.find((g) => g.index === Number(gpu))?.freeMb ?? 0 }))
    .filter((x) => x.free < x.need)
  if (short.length) {
    throw new Error(`Not enough free GPU memory for the video model: ${short.map((x) => `GPU ${x.gpu} has ${(x.free / 1024).toFixed(1)} GB, needs ${(x.need / 1024).toFixed(1)} GB`).join('; ')}. Free the main ComfyUI's VRAM or stop other GPU jobs.`)
  }
}

/** One take of one segment, as the video engine needs it. Paths are relative to Sosie's ComfyUI input folder. */
export type FilmRequest = {
  keyFrame: string; audio: string; prompt: string; format: Format; renderFrames: number; seed: number; lora: SpeedLora; outPrefix: string
  steps?: number; size?: { width: number; height: number }; refImageSize?: 'match' | 'max'
  signal?: AbortSignal
}
export type QcRequest = { video: string; audio: string; frames: number; out: string; words: Word[]; workDir: string }

/** What a job calls out to. The real ones drive Breeze TTS, Sosie's ComfyUI and the QC tool; tests swap in fakes. */
export type Engines = {
  speak: typeof speakScript
  /** Check the video model can run (service up, memory free) before the first take. */
  prepare: () => Promise<void>
  /** Film one take; returns the raw video file. */
  film: (request: FilmRequest) => Promise<string>
  release: () => Promise<void>
  qc: (request: QcRequest) => Promise<QcReport>
}

/** SyncNet weights for the lip-sync check, in the shared model store. */
export function syncnetWeights(config: SosieConfig): string {
  return join(config.paths.modelStore, 'syncnet', 'syncnet_v2.model')
}

/** How clearly a take is in sync (SyncNet LSE-C); picks the best of several takes. */
export function syncConfidence(qc: QcReport): number {
  return Number((qc.lipSync as { confidence?: number } | undefined)?.confidence ?? -1)
}

export function realEngines(config: SosieConfig, root = ROOT): Engines {
  const comfy = new ComfyClient(`http://127.0.0.1:${config.ports.comfy}`)
  return {
    speak: speakScript,
    prepare: async () => {
      if (!(await comfy.alive())) throw new Error("Sosie's ComfyUI is not running. Start services from the System panel.")
      await comfy.free() // unload image models before the video model
      await assertVram(config)
    },
    film: async ({ signal, ...input }) => {
      const result = await comfy.run(talkGraph(config, input), { onTick: () => { if (signal?.aborted) void comfy.interrupt() } })
      const raw = result.files.find((f) => f.filename.endsWith('.mp4'))
      if (!raw) throw new Error('The video model returned no video')
      return join(root, 'data', 'comfy-io', 'output', raw.subfolder, raw.filename)
    },
    release: async () => { await comfy.free() },
    qc: async ({ workDir, ...request }) => {
      await runPy('qc', {
        ...request, landmarker: join(root, 'py', 'models', 'face_landmarker.task'), syncnet: syncnetWeights(config),
      }, { gpu: null, workDir })
      return JSON.parse(readFileSync(request.out, 'utf8')) as QcReport
    },
  }
}

export type JobHooks = { signal?: AbortSignal; onUpdate?: (state: JobState) => void; root?: string; engines?: Engines }

/** Run (or resume) a job to the end. Every step is saved, so a crash or restart continues where it stopped. */
export async function runJob(config: SosieConfig, spec: JobSpec, hooks: JobHooks = {}): Promise<JobState> {
  const root = hooks.root ?? ROOT
  const state = loadJob(spec.id, root) ?? newJob(spec)
  state.spec = { ...state.spec, ...spec }
  state.status = 'running'
  state.error = undefined
  const dir = projectDir(spec.id, root)
  const update = (patch: Partial<JobState>) => {
    Object.assign(state, patch)
    saveJob(state, root)
    hooks.onUpdate?.(state)
  }
  const checkCancel = () => {
    if (hooks.signal?.aborted) throw new Error('canceled')
  }
  const time = async <T>(name: string, work: () => Promise<T>) => {
    const started = Date.now()
    try {
      return await work()
    } finally {
      state.timings[name] = (state.timings[name] ?? 0) + Math.round((Date.now() - started) / 100) / 10
    }
  }
  const engines = hooks.engines ?? realEngines(config, root)

  try {
    // 1–2. voice + word timings
    if (!state.voice || !existsSync(state.voice.wav)) {
      update({ step: 'voice', message: 'Recording the voice', progress: 0.02 })
      const track = await time('voice', () => engines.speak(config, spec.voiceId, spec.script, join(dir, 'voice'), {
        seed: spec.seed,
        onProgress: (done, total) => update({ message: `Voicing line ${done} of ${total}`, progress: 0.02 + 0.08 * (done / total) }),
      }, root))
      update({ voice: { wav: track.wav, durationS: track.durationS, words: track.words, lines: track.lines } })
    }
    checkCancel()

    // 3. segment plan
    if (!state.segments.length) {
      update({ step: 'plan', message: 'Planning segments', progress: 0.1 })
      const voice = state.voice!
      let segments = planSegments(voice.lines.map((l) => ({ text: l.text, direction: l.direction, startS: l.startS, durationS: l.durationS })), voice.words, framesFor(voice.durationS))
      if (spec.firstSegmentOnly) segments = segments.slice(0, 1)
      update({ segments: segments.map((s) => ({ ...s, status: 'pending', attempts: [], seedBase: spec.seed + s.index * 1000 })) })
    }

    // 4. key frame into Sosie's ComfyUI input folder
    update({ step: 'face', message: 'Preparing the face', progress: 0.12 })
    const face = getFace(spec.faceId, root)
    const inputRel = `sosie/${spec.id}`
    const inputDir = join(root, 'data', 'comfy-io', 'input', inputRel)
    mkdirSync(inputDir, { recursive: true })
    copyFileSync(faceFiles(spec.faceId, root).keyFrame, join(inputDir, 'keyframe.png'))

    // 5–7. H3 per segment: render, trim + exact audio, QC, one automatic re-roll
    const pending = state.segments.filter((s) => s.status === 'pending')
    if (pending.length) {
      await engines.prepare()
      update({ step: 'h3' })
      const segDir = join(dir, 'segments')
      mkdirSync(segDir, { recursive: true })
      for (const segment of pending) {
        checkCancel()
        const tag = `seg-${String(segment.index + 1).padStart(2, '0')}`
        const refAudio = `${inputRel}/${tag}.wav`
        await referenceAudio(state.voice!.wav, join(inputDir, `${tag}.wav`), segment.startS, segment.durationS, segment.renderFrames / FPS)
        const voiceCut = join(segDir, `${tag}-voice.wav`)
        await cutAudio(state.voice!.wav, voiceCut, segment.startS, segment.durationS)
        const prompt = talkPrompt({ subject: face.subject, set: face.set, text: segment.text || '…', direction: segment.direction })
        const firstAttempt = segment.attempts.length // fixed bound: attempts grows inside the loop
        for (let attempt = firstAttempt; attempt < firstAttempt + MAX_ATTEMPTS; attempt++) {
          checkCancel()
          const done = state.segments.filter((s) => s.status !== 'pending').length
          update({ message: `Filming segment ${segment.index + 1} of ${state.segments.length}${attempt ? ` (take ${attempt + 1})` : ''}`, progress: 0.15 + 0.75 * (done / state.segments.length) })
          const seed = segment.seedBase + attempt
          const started = Date.now()
          const raw = await time('h3', () => engines.film({
            keyFrame: `${inputRel}/keyframe.png`, audio: refAudio, prompt, format: spec.format,
            renderFrames: segment.renderFrames, seed, lora: spec.lora, outPrefix: `${inputRel}/${tag}-t${attempt + 1}`, signal: hooks.signal,
            steps: spec.steps, size: spec.size, refImageSize: spec.refImageSize,
          }))
          checkCancel()
          const file = join(segDir, `${tag}-t${attempt + 1}.mp4`)
          await trimAndMux(raw, voiceCut, segment.frames, FPS, file)
          const qcFile = join(segDir, `${tag}-t${attempt + 1}-qc.json`)
          const qc = await time('qc', () => engines.qc({ video: file, audio: voiceCut, frames: segment.frames, out: qcFile, words: segment.words, workDir: segDir }))
          segment.attempts.push({ seed, seconds: Math.round((Date.now() - started) / 1000), qc, file })
          if (qc.pass) {
            segment.status = 'done'
            segment.file = file
            break
          }
        }
        if (segment.status === 'pending') {
          // keep the take with the clearest lip sync and flag it for the user
          const best = [...segment.attempts].sort((a, b) => syncConfidence(b.qc) - syncConfidence(a.qc))[0]
          segment.status = 'flagged'
          segment.file = best.file
        }
        update({ segments: state.segments })
      }
      await engines.release()
    }
    checkCancel()

    // 8. join: segment videos + the untouched voice track
    update({ step: 'join', message: 'Joining segments', progress: 0.92 })
    const outDir = join(dir, 'out', `${slug(spec.name, spec.id)}.sosie`)
    mkdirSync(outDir, { recursive: true })
    const video = join(outDir, 'facecam.mp4')
    const totalFrames = state.segments.reduce((sum, s) => sum + s.frames, 0)
    await time('join', () => joinSegments(state.segments.map((s) => s.file!), state.voice!.wav, totalFrames, video, spec.punchIn, spec.size ?? FORMATS[spec.format]))

    // 9. bundle
    update({ step: 'bundle', message: 'Writing the bundle', progress: 0.97 })
    const durationS = totalFrames / FPS
    const words = state.voice!.words.filter((w) => w.start < durationS)
    const captions = join(outDir, 'captions.srt')
    writeFileSync(captions, toSrt(captionLines(words)))
    const wordsFile = join(outDir, 'words.json')
    writeFileSync(wordsFile, JSON.stringify(words))
    const poster = join(outDir, 'poster.jpg')
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.min(1, durationS / 2)), '-i', video, '-frames:v', '1', '-q:v', '3', poster])
    const voice = listVoices(root).find((v) => v.id === spec.voiceId)
    const projectFile = join(outDir, 'project.json')
    writeFileSync(projectFile, JSON.stringify({
      bundleVersion: 1,
      aiGenerated: true,
      createdAt: new Date().toISOString(),
      durationS,
      fps: FPS,
      ...(spec.size ?? FORMATS[spec.format]),
      voice: voice ? { id: voice.id, name: voice.name, kind: voice.kind } : { id: spec.voiceId },
      face: { id: face.id, name: face.name, kind: face.kind },
      look: face.set,
      script: spec.script,
      segments: state.segments.map((s) => ({
        index: s.index, startS: s.startS, endS: s.startS + s.durationS, frames: s.frames, renderFrames: s.renderFrames,
        seed: s.attempts.find((a) => a.file === s.file)?.seed, lora: spec.lora, steps: SPEED_LORAS[spec.lora].steps,
        // the bundle leaves this machine: no local file paths in it
        status: s.status, qc: { ...s.attempts.find((a) => a.file === s.file)?.qc, video: undefined },
      })),
      models: { ...H3_MODELS, speedLora: SPEED_LORAS[spec.lora].file },
    }, null, 1))
    // the QC report sits next to the bundle (the bundle's files are fixed by §6.6)
    const qcJson = join(dir, 'out', 'qc.json')
    const qcHtml = join(dir, 'out', 'qc.html')
    writeFileSync(qcJson, JSON.stringify(state.segments.map((s) => ({
      index: s.index, status: s.status, takes: s.attempts.length,
      qc: { ...s.attempts.find((a) => a.file === s.file)?.qc, video: undefined },
    })), null, 1))
    writeFileSync(qcHtml, qcReportHtml({ ...state, updatedAt: new Date().toISOString() }))
    update({
      status: 'done', step: 'done', progress: 1,
      message: state.segments.some((s) => s.status === 'flagged') ? 'Done — some segments need a look' : 'Done',
      outputs: { dir: outDir, video, captions, words: wordsFile, project: projectFile, poster, qcJson, qcHtml },
    })
    return state
  } catch (error) {
    const canceled = hooks.signal?.aborted || (error as Error).message === 'canceled'
    update({ status: canceled ? 'canceled' : 'failed', error: canceled ? undefined : (error as Error).message, message: canceled ? 'Canceled' : (error as Error).message })
    return state
  }
}

/** Concatenate the trimmed segment videos and lay the full voice track under them (one final encode). */
export async function joinSegments(files: string[], voiceWav: string, totalFrames: number, out: string, punchIn: boolean, size: { width: number; height: number }) {
  const inputs = files.flatMap((file) => ['-i', file])
  const audioIndex = files.length
  const parts = files.map((_, i) => {
    const zoom = punchIn && i % 2 === 1
    return zoom
      ? `[${i}:v]crop=iw/1.08:ih/1.08,scale=${size.width}:${size.height}:flags=lanczos,setsar=1[v${i}]`
      : `[${i}:v]setsar=1[v${i}]`
  })
  // the length is cut by filters, never by an output -frames:v (that ends the file before its audio)
  const graph = `${parts.join(';')};${files.map((_, i) => `[v${i}]`).join('')}concat=n=${files.length}:v=1:a=0,trim=end_frame=${totalFrames}[v]`
  const seconds = (totalFrames / FPS).toFixed(6)
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-i', voiceWav,
    '-filter_complex', graph, '-map', '[v]', '-map', `${audioIndex}:a:0`,
    '-af', `apad=whole_dur=${seconds},atrim=duration=${seconds}`,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-metadata', 'comment=AI-generated (Sosie)', '-movflags', '+faststart', out,
  ], { maxBuffer: 16 * 1024 * 1024 })
}
