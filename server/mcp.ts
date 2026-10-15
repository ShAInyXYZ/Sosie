import { readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { ROOT, loadConfig } from './config.ts'

/** This bridge talks only to the local Sosie API, without forwarding credentials. */
export function localApiUrl(raw = process.env.SOSIE_API_URL || `http://127.0.0.1:${loadConfig().ports.api}`): URL {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('SOSIE_API_URL must be a loopback HTTP(S) origin, such as http://127.0.0.1:3190, without credentials or a path.')
  }
  return url
}

const guide = `# Make a talking video with Sosie

Sosie films a lip-synced talking-head facecam: a chosen face says a script in a chosen voice. Rendering runs on local GPUs and takes a few minutes per 8 to 10 seconds of video.

1. sosie_status: services up, GPU memory, whether Dots TTS is set up.
2. sosie_list_faces and sosie_list_voices. To film a real person (the user), add their photo with sosie_import_photo_face and their voice with sosie_import_voice (a 5 to 20 s clean sample and its exact transcript). Both need consent: it is them, or they agreed.
3. Write the script yourself in Sosie's line format (sosie://voice-prompting has the rules), or call sosie_write_script. One breath per line, with a note and controls in a trailing bracket:
   We shipped the update button today. [proud, upbeat, a quick smile; pace 1.0; pause 0.5]
   Breeze performs (laugh), (sigh), (cough) and (clears throat) in the text; Dots does not, so put the feeling in the wording.
4. sosie_make_video with the script, faceId and voiceId (voiceEngine "dots" for the cleanest sound, "breeze" to follow delivery notes). firstSegmentOnly renders a quick check of the first segment.
5. Poll sosie_get_job (waitSeconds up to 50) until status is done, failed or canceled. Segments flagged by the lip-sync check can be re-rendered with sosie_reroll_segment.
6. The result is a bundle folder (outputs.dir) with facecam.mp4, captions.srt, words.json, project.json and poster.jpg. Hand it to MOceanX: sosie_send_to_moceanx imports it into a new native project, or give outputs.dir to MOceanX's moceanx_import_sosie, or add facecam.mp4 to an explainer composition with moceanx_add_composition_media.

Every output is tagged "AI-generated (Sosie)".
`

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const localWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
const jobId = z.string().min(1).max(200).describe('Video (job) ID returned by sosie_make_video.')
const format = z.enum(['corner', 'reel', 'wide']).describe('corner 768×768 (default), reel 576×1024, wide 1024×576')

function result(value: unknown): CallToolResult {
  const structuredContent = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { result: value }
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent }
}

async function run(action: () => Promise<unknown>): Promise<CallToolResult> {
  try { return result(await action()) }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { isError: true, content: [{ type: 'text', text: message }], structuredContent: { error: message } }
  }
}

/** A local file for an upload: it must exist; the name keeps its extension for the API's checks. */
async function localFile(path: string, field: string): Promise<{ blob: Blob; name: string }> {
  const file = resolve(path)
  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) throw new Error(`${field}: no file at ${file}`)
  if (info.size > 100 * 1024 * 1024) throw new Error(`${field}: ${file} is larger than 100 MB`)
  return { blob: new Blob([await readFile(file)]), name: basename(file) }
}

type Job = {
  spec: { id: string; name: string; voiceEngine?: string; format: string }
  status: string; step: string; progress: number; message: string; error?: string
  segments: { index: number; status: string; attempts: { qc?: { lipSync?: { confidence?: number } } }[] }[]
  outputs?: { dir: string; video: string; captions: string; words: string; project: string; poster: string; qcHtml?: string }
  timings: Record<string, number>
}

/** What an agent needs from a job: progress, each segment's lip-sync verdict, and the bundle when done. */
function jobSummary(job: Job) {
  return {
    id: job.spec.id, name: job.spec.name, status: job.status, step: job.step, progress: Math.round(job.progress * 100) / 100,
    message: job.message, error: job.error, voiceEngine: job.spec.voiceEngine ?? 'breeze', format: job.spec.format,
    segments: job.segments.map((segment) => ({
      segment: segment.index + 1, status: segment.status, takes: segment.attempts.length,
      lipSyncConfidence: segment.attempts.at(-1)?.qc?.lipSync?.confidence,
    })),
    outputs: job.outputs, timings: job.timings,
  }
}

export function createMcpServer(apiOrigin = localApiUrl()): McpServer {
  const api = localApiUrl(apiOrigin.href)
  const request = async <T = unknown>(route: string, method = 'GET', body?: unknown): Promise<T> => {
    let response: Response
    try {
      response = await fetch(new URL(route, api), {
        method, redirect: 'error', signal: AbortSignal.timeout(10 * 60_000),
        headers: body === undefined || body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      })
    } catch (error) {
      throw new Error(`Cannot reach the Sosie API at ${api.origin}. Start it with scripts/start.sh. ${error instanceof Error ? error.message : String(error)}`)
    }
    const text = await response.text()
    let value: unknown
    try { value = JSON.parse(text) }
    catch { throw new Error(`Sosie returned HTTP ${response.status} with a non-JSON response.`) }
    if (!response.ok) {
      const detail = typeof value === 'object' && value !== null && 'error' in value ? String(value.error) : text
      throw new Error(`Sosie HTTP ${response.status}: ${detail}`)
    }
    return value as T
  }
  const server = new McpServer({ name: 'sosie', version: '0.1.0' }, {
    instructions: 'Sosie films a lip-synced talking-head facecam of a face saying a script in a voice, on local GPUs. Read sosie://guide, list faces and voices, write the script in Sosie\'s line format, start sosie_make_video and poll sosie_get_job, then hand outputs.dir to MOceanX.',
  })

  server.registerResource('guide', 'sosie://guide', { title: 'Making a Sosie video', mimeType: 'text/markdown' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: guide }],
  }))
  server.registerResource('voice-prompting', 'sosie://voice-prompting', { title: 'Script lines, delivery notes and the two voice engines', mimeType: 'text/markdown' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await readFile(join(ROOT, 'docs', 'VOICE_PROMPTING.md'), 'utf8') }],
  }))

  server.registerTool('sosie_status', {
    description: 'Services (API, ComfyUI, Python tools), GPU memory, configuration problems, whether the Dots voice engine is set up, and the build.', inputSchema: {}, annotations: readOnly,
  }, () => run(async () => ({ apiUrl: api.origin, build: await request('/api/update'), ...await request<object>('/api/system') })))

  server.registerTool('sosie_list_faces', {
    description: 'Faces Sosie can film: photos of real people (imported with consent) and created characters.', inputSchema: {}, annotations: readOnly,
  }, () => run(() => request('/api/faces')))

  server.registerTool('sosie_list_voices', {
    description: 'Voices Sosie can speak with: cloned from a sample (with consent) or designed from a description.', inputSchema: {}, annotations: readOnly,
  }, () => run(() => request('/api/voices')))

  server.registerTool('sosie_list_looks', {
    description: 'Set presets (the room behind a photo or a new character).', inputSchema: {}, annotations: readOnly,
  }, () => run(() => request('/api/looks')))

  server.registerTool('sosie_import_photo_face', {
    description: 'Add a real person from a photo: one face, facing the camera, chest up works best. The person is cut out (pixels kept) and placed over a generated set. Needs consent: it is the user, or the person agreed. Takes about a minute on the GPU.',
    inputSchema: {
      photoPath: z.string().min(1).describe('Absolute path of a JPG or PNG photo on this machine.'),
      name: z.string().min(1).max(80),
      consent: z.literal(true).describe('true: this is the user, or the person agreed to be filmed by Sosie.'),
      look: z.string().optional().describe('Set preset id from sosie_list_looks (default home-office).'),
      format: format.optional(),
      subject: z.string().max(300).optional().describe('Who is on camera, e.g. "a man in his thirties with short dark hair"; helps the video prompt.'),
    },
    annotations: localWrite,
  }, ({ photoPath, name, consent, look, format: fmt, subject }) => run(async () => {
    const photo = await localFile(photoPath, 'photoPath')
    const form = new FormData()
    form.set('photo', photo.blob, photo.name)
    form.set('name', name)
    form.set('consent', String(consent))
    if (look) form.set('look', look)
    if (fmt) form.set('format', fmt)
    if (subject) form.set('subject', subject)
    return request('/api/faces/photo', 'POST', form)
  }))

  server.registerTool('sosie_import_voice', {
    description: 'Clone a voice from a clean 5 to 20 s sample and its exact transcript. Needs consent: it is the user\'s voice, or the speaker agreed.',
    inputSchema: {
      samplePath: z.string().min(1).describe('Absolute path of a WAV, MP3, M4A or FLAC sample on this machine.'),
      transcript: z.string().min(1).max(2000).describe('The exact words spoken in the sample.'),
      name: z.string().min(1).max(80),
      consent: z.literal(true).describe('true: this is the user\'s voice, or the speaker agreed.'),
    },
    annotations: localWrite,
  }, ({ samplePath, transcript, name, consent }) => run(async () => {
    const sample = await localFile(samplePath, 'samplePath')
    const form = new FormData()
    form.set('sample', sample.blob, sample.name)
    form.set('transcript', transcript)
    form.set('name', name)
    form.set('consent', String(consent))
    return request('/api/voices/import', 'POST', form)
  }))

  server.registerTool('sosie_design_voice', {
    description: 'Make a new voice from a description, e.g. "a warm, calm woman in her forties". Uses the GPU for about a minute.',
    inputSchema: { name: z.string().min(1).max(80), description: z.string().min(1).max(500) },
    annotations: localWrite,
  }, ({ name, description }) => run(() => request('/api/voices/design', 'POST', { name, description })))

  server.registerTool('sosie_write_script', {
    description: 'Ask the Claude Code or Codex CLI signed in on this machine to write a script in Sosie\'s line format for the chosen engine. When you are an AI agent, you can write it yourself instead (sosie://voice-prompting).',
    inputSchema: {
      brief: z.string().min(1).max(2000).describe('What the video should say, its tone and length, e.g. "recap my day in about a minute, upbeat".'),
      context: z.string().max(200_000).optional().describe('Notes, commit messages, an article: data the script is based on.'),
      engine: z.enum(['breeze', 'dots']).optional(),
    },
    annotations: { ...localWrite, openWorldHint: true },
  }, ({ brief, context, engine }) => run(() => request('/api/script/write', 'POST', { brief, context: context ?? '', engine })))

  server.registerTool('sosie_make_video', {
    description: 'Start a video: the face says the script in the voice. Returns the job at once; rendering takes a few minutes per 8 to 10 s. Poll sosie_get_job.',
    inputSchema: {
      script: z.string().min(1).max(20_000).describe('One breath per line; a trailing [note; pace 0.9; pause 1.2] sets delivery (sosie://voice-prompting).'),
      faceId: z.string().min(1),
      voiceId: z.string().min(1),
      name: z.string().max(80).optional(),
      format: format.optional(),
      voiceEngine: z.enum(['breeze', 'dots']).optional().describe('breeze (default) follows delivery notes; dots has the cleanest sound when set up.'),
      firstSegmentOnly: z.boolean().optional().describe('Voice the whole script but film only the first segment, as a quick check.'),
      punchIn: z.boolean().optional().describe('Every other segment 8 % closer, the jump-cut style.'),
      seed: z.number().int().min(0).optional(),
    },
    annotations: localWrite,
  }, (input) => run(async () => jobSummary(await request<Job>('/api/jobs', 'POST', input))))

  server.registerTool('sosie_get_job', {
    description: 'A video\'s progress, each segment\'s lip-sync check, and when done the bundle (outputs.dir with facecam.mp4, captions.srt, words.json). waitSeconds waits for it to finish, up to 50 s per call.',
    inputSchema: { id: jobId, waitSeconds: z.number().int().min(0).max(50).optional() },
    annotations: readOnly,
  }, ({ id, waitSeconds }) => run(async () => {
    const until = Date.now() + (waitSeconds ?? 0) * 1000
    let job = await request<Job>(`/api/jobs/${encodeURIComponent(id)}`)
    while ((job.status === 'queued' || job.status === 'running') && Date.now() < until) {
      await new Promise((done) => setTimeout(done, 3000))
      job = await request<Job>(`/api/jobs/${encodeURIComponent(id)}`)
    }
    return jobSummary(job)
  }))

  server.registerTool('sosie_list_jobs', {
    description: 'Videos made or in progress, newest first.', inputSchema: {}, annotations: readOnly,
  }, () => run(async () => (await request<{ jobs: Job[] }>('/api/jobs')).jobs.map((job) => ({ id: job.spec.id, name: job.spec.name, status: job.status, message: job.message }))))

  server.registerTool('sosie_cancel_job', {
    description: 'Stop a queued or rendering video. Finished segments are kept; sosie_resume_job continues it.', inputSchema: { id: jobId }, annotations: localWrite,
  }, ({ id }) => run(() => request(`/api/jobs/${encodeURIComponent(id)}`, 'DELETE')))

  server.registerTool('sosie_resume_job', {
    description: 'Continue a canceled or failed video from where it stopped.', inputSchema: { id: jobId }, annotations: localWrite,
  }, ({ id }) => run(async () => jobSummary(await request<Job>(`/api/jobs/${encodeURIComponent(id)}/resume`, 'POST'))))

  server.registerTool('sosie_reroll_segment', {
    description: 'Film one segment again with a new seed (for a take flagged by the lip-sync check, or one you do not like), then join the video again.',
    inputSchema: { id: jobId, segment: z.number().int().min(1).describe('Segment number, from 1.') },
    annotations: localWrite,
  }, ({ id, segment }) => run(async () => jobSummary(await request<Job>(`/api/jobs/${encodeURIComponent(id)}/reroll`, 'POST', { segment }))))

  server.registerTool('sosie_send_to_moceanx', {
    description: 'Import a finished video into MOceanX (it must be running) as a new native project: the facecam bottom-right with word-timed captions. Returns the project folder, or why not and the bundle path.',
    inputSchema: { id: jobId },
    annotations: localWrite,
  }, ({ id }) => run(() => request(`/api/jobs/${encodeURIComponent(id)}/send`, 'POST')))

  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createMcpServer()
  await server.connect(new StdioServerTransport())
}
