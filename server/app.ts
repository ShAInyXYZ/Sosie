import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from 'express'
import { ROOT, type SosieConfig } from './config.ts'
import { systemStatus } from './system.ts'
import { JobError, JobManager } from './jobs.ts'
import multer from 'multer'
import { trashItem, type LibraryKind } from './library.ts'
import { faceFiles, listFaces } from './pipeline/faces.ts'
import { characterCandidates, chooseCharacter, defaultImageLora, imageSteps, photoFace, type CharacterForm, type ImageLora, type LookId } from './pipeline/look.ts'
import { designVoice, dotsMissing, importVoice } from './pipeline/voice.ts'
import { sendToMoceanx } from './moceanx.ts'
import { scriptProviders, writeScript } from './script-ai.ts'
import { FORMATS, SPEED_LORAS, type Format, type SpeedLora } from './pipeline/h3.ts'
import { LOOKS } from './pipeline/look.ts'
import { parseScript } from './pipeline/script.ts'
import { listVoices } from './pipeline/voice.ts'

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]']

export const VERSION = '0.1.0'

/** Only this machine may talk to Sosie: localhost Host header, and a local Origin when one is sent. */
function localOnly(config: SosieConfig) {
  const allowedOrigins = new Set(
    LOCAL_HOSTS.flatMap((host) => [config.ports.web, config.ports.api].map((port) => `http://${host}:${port}`)),
  )
  return (request: Request, response: Response, next: NextFunction) => {
    let host = ''
    try {
      host = new URL(`http://${request.headers.host ?? ''}`).hostname
    } catch {
      host = ''
    }
    if (!LOCAL_HOSTS.includes(host)) {
      response.status(403).json({ error: 'Sosie accepts requests addressed to localhost only.' })
      return
    }
    const origin = request.headers.origin
    if (origin && !allowedOrigins.has(origin)) {
      response.status(403).json({ error: 'Only the Sosie app can use this API.' })
      return
    }
    next()
  }
}

export function createApp(config: SosieConfig, options: { jobs?: JobManager; root?: string } = {}) {
  const jobs = options.jobs ?? new JobManager(config)
  const root = options.root ?? ROOT
  const app = express()
  app.disable('x-powered-by')
  app.use(localOnly(config))
  app.use(express.json({ limit: '2mb' }))

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true, app: 'sosie', version: VERSION })
  })

  app.get('/api/system', async (_request, response) => {
    // dots: null when the Dots voice engine can run, else why not
    response.json({ ...(await systemStatus(config)), dots: dotsMissing(config, root) })
  })
  // Start Sosie's own ComfyUI (the API is already up if this answers)
  app.post('/api/system/start', (_request, response) => {
    const child = spawn('bash', [join(ROOT, 'scripts', 'start.sh'), 'comfy'], { cwd: ROOT, detached: true, stdio: 'ignore' })
    child.unref()
    response.status(202).json({ starting: true })
  })
  // Unload the main ComfyUI's models through its own API (its files and settings are not touched)
  app.post('/api/system/free-main', async (_request, response) => {
    const answer = await fetch(new URL('/free', config.mainComfyUrl), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(10_000),
    }).catch(() => null)
    if (!answer?.ok) throw new JobError('The main ComfyUI did not answer.', 502)
    response.json({ freed: true })
  })

  // Library
  const uploadDir = join(root, 'data', 'uploads')
  mkdirSync(uploadDir, { recursive: true })
  const uploads = multer({ dest: uploadDir, limits: { fileSize: 200 * 1024 * 1024 } })
  const lookOf = (value: unknown): LookId => {
    if (typeof value !== 'string' || !LOOKS.some((look) => look.id === value)) return 'home-office'
    return value as LookId
  }
  const formatOf = (value: unknown): Format => (typeof value === 'string' && value in FORMATS ? value as Format : 'corner')

  app.get('/api/faces', (_request, response) => response.json({ faces: listFaces(root) }))
  app.get('/api/faces/:id/keyframe', (request, response) => {
    const file = faceFiles(request.params.id, root).keyFrame
    if (!/^[A-Za-z0-9-]+$/.test(request.params.id) || !existsSync(file)) throw new JobError('No such face.', 404)
    response.sendFile(file)
  })
  // a real photo: the person is cut out (pixels kept) and placed over a generated set
  app.post('/api/faces/photo', uploads.single('photo'), async (request, response) => {
    const photo = request.file
    if (!photo) throw new JobError('Choose a photo.')
    const face = await jobs.exclusive(() => photoFace(config, {
      photo: photo.path, name: String(request.body?.name ?? 'Me'), lookId: lookOf(request.body?.look),
      format: formatOf(request.body?.format), consent: request.body?.consent === 'true', subject: String(request.body?.subject ?? ''),
    }, root)).catch((error: Error) => { throw new JobError(error.message) })
    response.status(201).json(face)
  })
  // a character: four options to choose from
  app.get('/api/image-loras', (_request, response) => response.json({
    loras: config.loras.qwenImage21.map((file) => ({ file, steps: imageSteps({ file, strength: 1 }) })),
    default: defaultImageLora(config),
  }))
  app.post('/api/faces/characters', async (request, response) => {
    const form = request.body?.form as CharacterForm | undefined
    if (!form || typeof form.who !== 'string' || !form.who.trim()) throw new JobError('Describe who is on camera.')
    const asked = request.body?.lora as Partial<ImageLora> | null | undefined
    let lora: ImageLora | null = defaultImageLora(config)
    if (asked === null) lora = null
    else if (asked) {
      if (typeof asked.file !== 'string' || !config.loras.qwenImage21.includes(asked.file)) throw new JobError('Unknown LoRA.')
      lora = { file: asked.file, strength: Math.min(2, Math.max(0, Number(asked.strength ?? 1))) }
    }
    const files = await jobs.exclusive(() => characterCandidates(config, form, lookOf(request.body?.look), formatOf(request.body?.format), 4, root, lora))
    response.json({ candidates: files.map((file) => file.slice(join(root, 'data', 'candidates').length + 1)) })
  })
  app.get('/api/candidates/:batch/:file', (request, response) => {
    const { batch, file } = request.params
    if (!/^[a-z0-9-]+$/i.test(batch) || !/^\d+\.png$/.test(file)) throw new JobError('No such image.', 404)
    response.sendFile(join(root, 'data', 'candidates', batch, file))
  })
  app.post('/api/faces/characters/choose', (request, response) => {
    const candidate = String(request.body?.candidate ?? '')
    if (!/^[a-z0-9-]+\/\d+\.png$/i.test(candidate)) throw new JobError('Choose one of the options.')
    response.status(201).json(chooseCharacter(join(root, 'data', 'candidates', candidate), String(request.body?.name ?? 'Character'), root))
  })

  app.get('/api/voices', (_request, response) => response.json({ voices: listVoices(root) }))
  app.post('/api/voices/import', uploads.single('sample'), async (request, response) => {
    if (!request.file) throw new JobError('Choose a voice sample.')
    const voice = await importVoice({
      name: String(request.body?.name ?? 'Me'), sample: request.file.path,
      transcript: String(request.body?.transcript ?? ''), consent: request.body?.consent === 'true',
    }, root).catch((error: Error) => { throw new JobError(error.message) })
    response.status(201).json(voice)
  })
  app.post('/api/voices/design', async (request, response) => {
    const voice = await jobs.exclusive(() => designVoice(config, { name: String(request.body?.name ?? ''), description: String(request.body?.description ?? '') }, root))
      .catch((error: Error) => { throw new JobError(error.message) })
    response.status(201).json(voice)
  })

  app.get('/api/looks', (_request, response) => response.json({ looks: LOOKS }))

  // Script AI: the local Claude Code or Codex CLI writes; the user edits
  app.get('/api/script/providers', async (_request, response) => response.json({ providers: await scriptProviders() }))
  app.post('/api/script/write', async (request, response) => {
    const script = await writeScript(String(request.body?.context ?? ''), String(request.body?.brief ?? ''), { engine: request.body?.engine === 'dots' ? 'dots' : 'breeze' })
      .catch((error: Error) => { throw new JobError(error.message, 502) })
    response.json({ script })
  })

  app.delete('/api/library/:kind/:id', (request, response) => {
    const kind = request.params.kind as LibraryKind
    if (!['faces', 'voices', 'videos'].includes(kind)) throw new JobError('Unknown library.', 404)
    if (kind === 'videos' && jobs.get(request.params.id)?.status === 'running') throw new JobError('Cancel this video first.', 409)
    if (!trashItem(kind, request.params.id, root)) throw new JobError('Not found.', 404)
    response.json({ ok: true })
  })

  // Jobs: one video each
  app.get('/api/jobs', (_request, response) => response.json({ jobs: jobs.list() }))
  app.post('/api/jobs', (request, response) => {
    const body = request.body ?? {}
    const script = typeof body.script === 'string' ? parseScript(body.script) : []
    if (!script.length) throw new JobError('Write the script first.')
    if (typeof body.faceId !== 'string' || !listFaces(root).some((face) => face.id === body.faceId)) throw new JobError('Choose a face first.')
    if (typeof body.voiceId !== 'string' || !listVoices(root).some((voice) => voice.id === body.voiceId)) throw new JobError('Choose a voice first.')
    const format = (body.format ?? 'corner') as Format
    const lora = (body.lora ?? 'taomate') as SpeedLora
    if (!(format in FORMATS)) throw new JobError(`Unknown format ${format}.`)
    if (!(lora in SPEED_LORAS)) throw new JobError(`Unknown speed LoRA ${lora}.`)
    const steps = Number.isInteger(body.steps) && body.steps >= 1 && body.steps <= 50 ? body.steps as number : undefined
    const size = body.size && [body.size.width, body.size.height].every((v: unknown) => Number.isInteger(v) && (v as number) >= 256 && (v as number) <= 1536 && (v as number) % 32 === 0)
      ? { width: body.size.width as number, height: body.size.height as number } : undefined
    if (body.size && !size) throw new JobError('Width and height go from 256 to 1536 in steps of 32.')
    const voiceEngine = body.voiceEngine === 'dots' ? 'dots' : undefined
    const dotsProblem = voiceEngine && dotsMissing(config, root)
    if (dotsProblem) throw new JobError(dotsProblem)
    response.status(201).json(jobs.start({
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : script[0].text.slice(0, 48),
      script, faceId: body.faceId, voiceId: body.voiceId, format, lora,
      seed: Number.isInteger(body.seed) ? body.seed : 42, punchIn: body.punchIn === true, firstSegmentOnly: body.firstSegmentOnly === true,
      steps, size, refImageSize: body.refImageSize === 'match' ? 'match' : undefined, voiceEngine,
    }))
  })
  app.get('/api/jobs/:id', (request, response) => {
    const job = jobs.get(request.params.id)
    if (!job) throw new JobError('No such video.', 404)
    response.json(job)
  })
  app.delete('/api/jobs/:id', (request, response) => {
    const job = jobs.cancel(request.params.id)
    if (!job) throw new JobError('No such video.', 404)
    response.json(job)
  })
  app.post('/api/jobs/:id/resume', (request, response) => response.json(jobs.resume(request.params.id)))
  app.post('/api/jobs/:id/reroll', (request, response) => {
    const segment = Number(request.body?.segment)
    if (!Number.isInteger(segment) || segment < 1) throw new JobError('segment is the 1-based segment number.')
    response.json(jobs.reroll(request.params.id, segment - 1))
  })
  app.post('/api/jobs/:id/send', async (request, response) => {
    const job = jobs.get(request.params.id)
    if (!job?.outputs) throw new JobError('This video is not finished yet.', 409)
    response.json(await sendToMoceanx(config.moceanxUrl, job.outputs.dir))
  })
  app.get('/api/jobs/:id/files/:name', (request, response) => {
    const file = jobs.file(request.params.id, request.params.name)
    if (!file) throw new JobError('That file is not ready.', 404)
    response.sendFile(file)
  })

  const dist = join(ROOT, 'dist')
  if (existsSync(join(dist, 'index.html'))) {
    app.use(express.static(dist))
    app.get(/^\/(?!api\/).*/, (_request, response) => response.sendFile(join(dist, 'index.html')))
  }
  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    const status = error instanceof JobError ? error.status : error?.type === 'entity.parse.failed' ? 400 : 500
    response.status(status).json({ error: error instanceof Error ? error.message : String(error) })
  }
  app.use(errors)
  return app
}
