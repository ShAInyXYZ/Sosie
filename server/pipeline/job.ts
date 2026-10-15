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
  outputs?: { dir: string; video: string; captions: string; words: string; project: string; poster: string }
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

export type JobHooks = { signal?: AbortSignal; onUpdate?: (state: JobState) => void; root?: string }

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
  const comfy = new ComfyClient(`http://127.0.0.1:${config.ports.comfy}`)

  try {
    // 1–2. voice + word timings
    if (!state.voice || !existsSync(state.voice.wav)) {
      update({ step: 'voice', message: 'Recording the voice', progress: 0.02 })
      const track = await time('voice', () => speakScript(config, spec.voiceId, spec.script, join(dir, 'voice'), {
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
      if (!(await comfy.alive())) throw new Error("Sosie's ComfyUI is not running. Start services from the System panel.")
      await comfy.free() // unload image models before the video model
      await assertVram(config)
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
          const result = await time('h3', () => comfy.run(talkGraph(config, {
            keyFrame: `${inputRel}/keyframe.png`, audio: refAudio, prompt, format: spec.format,
            renderFrames: segment.renderFrames, seed, lora: spec.lora, outPrefix: `${inputRel}/${tag}-t${attempt + 1}`,
          }), { onTick: () => { if (hooks.signal?.aborted) void comfy.interrupt() } }))
          checkCancel()
          const raw = result.files.find((f) => f.filename.endsWith('.mp4'))
          if (!raw) throw new Error(`Segment ${segment.index + 1}: the video model returned no video`)
          const file = join(segDir, `${tag}-t${attempt + 1}.mp4`)
          await trimAndMux(join(root, 'data', 'comfy-io', 'output', raw.subfolder, raw.filename), voiceCut, segment.frames, FPS, file)
          const qcFile = join(segDir, `${tag}-t${attempt + 1}-qc.json`)
          await time('qc', () => runPy('qc', { video: file, audio: voiceCut, frames: segment.frames, landmarker: join(root, 'py', 'models', 'face_landmarker.task'), out: qcFile, words: segment.words }, { gpu: null, workDir: segDir }))
          const qc = JSON.parse(readFileSync(qcFile, 'utf8')) as QcReport
          segment.attempts.push({ seed, seconds: Math.round((Date.now() - started) / 1000), qc, file })
          if (qc.pass) {
            segment.status = 'done'
            segment.file = file
            break
          }
        }
        if (segment.status === 'pending') {
          // keep the take with the clearest lip sync and flag it for the user
          const score = (a: Attempt) => Number(((a.qc.lipSync as { envelope?: { margin?: number } } | undefined)?.envelope?.margin) ?? -1)
          const best = [...segment.attempts].sort((a, b) => score(b) - score(a))[0]
          segment.status = 'flagged'
          segment.file = best.file
        }
        update({ segments: state.segments })
      }
      await comfy.free()
    }
    checkCancel()

    // 8. join: segment videos + the untouched voice track
    update({ step: 'join', message: 'Joining segments', progress: 0.92 })
    const outDir = join(dir, 'out', `${slug(spec.name, spec.id)}.sosie`)
    mkdirSync(outDir, { recursive: true })
    const video = join(outDir, 'facecam.mp4')
    const totalFrames = state.segments.reduce((sum, s) => sum + s.frames, 0)
    await time('join', () => joinSegments(state.segments.map((s) => s.file!), state.voice!.wav, totalFrames, video, spec.punchIn, FORMATS[spec.format]))

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
      ...FORMATS[spec.format],
      voice: voice ? { id: voice.id, name: voice.name, kind: voice.kind } : { id: spec.voiceId },
      face: { id: face.id, name: face.name, kind: face.kind },
      look: face.set,
      script: spec.script,
      segments: state.segments.map((s) => ({
        index: s.index, startS: s.startS, endS: s.startS + s.durationS, frames: s.frames, renderFrames: s.renderFrames,
        seed: s.attempts.find((a) => a.file === s.file)?.seed, lora: spec.lora, steps: SPEED_LORAS[spec.lora].steps,
        status: s.status, qc: s.attempts.find((a) => a.file === s.file)?.qc,
      })),
      models: { ...H3_MODELS, speedLora: SPEED_LORAS[spec.lora].file },
    }, null, 1))
    update({
      status: 'done', step: 'done', progress: 1,
      message: state.segments.some((s) => s.status === 'flagged') ? 'Done — some segments need a look' : 'Done',
      outputs: { dir: outDir, video, captions, words: wordsFile, project: projectFile, poster },
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
  const graph = `${parts.join(';')};${files.map((_, i) => `[v${i}]`).join('')}concat=n=${files.length}:v=1:a=0[v]`
  const seconds = (totalFrames / FPS).toFixed(6)
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-i', voiceWav,
    '-filter_complex', graph, '-map', '[v]', '-map', `${audioIndex}:a:0`,
    '-af', `apad=whole_dur=${seconds},atrim=duration=${seconds}`,
    '-frames:v', String(totalFrames),
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-metadata', 'comment=AI-generated (Sosie)', '-movflags', '+faststart', out,
  ], { maxBuffer: 16 * 1024 * 1024 })
}
