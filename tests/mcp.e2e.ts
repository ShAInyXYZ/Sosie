import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createApp } from '../server/app.ts'
import { ROOT, configSchema } from '../server/config.ts'
import { JobManager } from '../server/jobs.ts'
import { localApiUrl } from '../server/mcp.ts'
import { fakeEngines } from '../server/testing/fake-engines.ts'

// The Sosie MCP over stdio against a real API with fake engines: tools, guides, a voice import, a video to its bundle.
for (const url of ['https://example.com', 'http://127.0.0.1:3190/api', 'http://user:secret@localhost', 'http://localhost?token=x']) {
  assert.throws(() => localApiUrl(url), /must be a loopback/, `refuses ${url}`)
}

const root = mkdtempSync(join(tmpdir(), 'sosie-mcp-'))
for (const [kind, id, meta] of [
  ['faces', 'face-1', { id: 'face-1', name: 'Alex', kind: 'character', subject: 'a presenter', set: 'a home office', consent: true, createdAt: '2026-10-16T00:00:00Z' }],
  ['voices', 'voice-1', { id: 'voice-1', name: 'Narrator', kind: 'designed', consent: true, createdAt: '2026-10-16T00:00:00Z' }],
] as const) {
  mkdirSync(join(root, 'data', kind, id), { recursive: true })
  writeFileSync(join(root, 'data', kind, id, kind === 'faces' ? 'face.json' : 'voice.json'), JSON.stringify(meta))
}
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64', '-frames:v', '1', join(root, 'data', 'faces', 'face-1', 'keyframe.png')])
const sample = join(root, 'sample.wav')
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=180:d=6', sample])

const config = configSchema.parse(JSON.parse(readFileSync(join(ROOT, 'config', 'sosie.example.json'), 'utf8')))
const app = createApp(config, { root, jobs: new JobManager(config, { root, engines: fakeEngines({ root }) }) })
const api = app.listen(0, '127.0.0.1')
await new Promise<void>((done) => api.once('listening', done))
const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`

const client = new Client({ name: 'sosie-mcp-test', version: '1.0.0' })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(ROOT, 'node_modules/tsx/dist/cli.mjs'), resolve(ROOT, 'server/mcp.ts')],
  cwd: root,
  env: { ...getDefaultEnvironment(), SOSIE_API_URL: apiUrl },
  stderr: 'pipe',
})
type Structured = Record<string, unknown>
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const answer = await client.callTool({ name, arguments: args })
  return { error: answer.isError === true, value: answer.structuredContent as Structured }
}

try {
  await client.connect(transport)
  const tools = (await client.listTools()).tools.map((tool) => tool.name)
  for (const name of ['sosie_status', 'sosie_list_faces', 'sosie_list_voices', 'sosie_import_photo_face', 'sosie_import_voice', 'sosie_write_script', 'sosie_make_video', 'sosie_get_job', 'sosie_reroll_segment', 'sosie_send_to_moceanx']) {
    assert.ok(tools.includes(name), `lists ${name}`)
  }
  const guide = await client.readResource({ uri: 'sosie://guide' })
  assert.match(String((guide.contents[0] as { text: string }).text), /sosie_make_video/)
  const voiceGuide = await client.readResource({ uri: 'sosie://voice-prompting' })
  assert.match(String((voiceGuide.contents[0] as { text: string }).text), /pause/)

  const status = await call('sosie_status')
  assert.equal(status.error, false, JSON.stringify(status.value))
  assert.equal(status.value.apiUrl, apiUrl)
  const faces = (await call('sosie_list_faces')).value as { faces: { id: string }[] }
  assert.deepEqual(faces.faces.map((face) => face.id), ['face-1'])

  // consent is required, and an imported voice shows up in the list
  assert.equal((await call('sosie_import_voice', { samplePath: sample, transcript: 'A test tone.', name: 'Me', consent: false })).error, true)
  const voice = (await call('sosie_import_voice', { samplePath: sample, transcript: 'A test tone.', name: 'Me', consent: true })).value as { id: string; kind: string }
  assert.equal(voice.kind, 'clone')
  const voices = (await call('sosie_list_voices')).value as { voices: { id: string }[] }
  assert.ok(voices.voices.some((entry) => entry.id === voice.id))

  const started = await call('sosie_make_video', {
    script: 'We shipped the update button today. [proud, upbeat; pace 1.0; pause 0.5]\nAnd Sosie went public. [a quick smile; pause 0.8]',
    faceId: 'face-1', voiceId: 'voice-1', name: 'Recap',
  })
  assert.equal(started.error, false, JSON.stringify(started.value))
  let job = started.value as { id: string; status: string; outputs?: { dir: string; video: string } }
  for (let i = 0; i < 20 && job.status !== 'done' && job.status !== 'failed'; i++) {
    job = (await call('sosie_get_job', { id: job.id, waitSeconds: 50 })).value as typeof job
  }
  assert.equal(job.status, 'done')
  assert.ok(job.outputs && existsSync(join(job.outputs.dir, 'facecam.mp4')), 'the bundle has its facecam')
  assert.ok(((await call('sosie_list_jobs')).value.result as { id: string }[]).some((entry) => entry.id === job.id))

  const missing = await call('sosie_get_job', { id: 'nope' })
  assert.equal(missing.error, true)
  assert.match(String(missing.value.error), /No such video/)
  console.log(`Sosie MCP E2E passed: ${tools.length} tools, guides, voice import with consent, a video to its bundle, errors.`)
} finally {
  await client.close().catch(() => {})
  api.close()
  rmSync(root, { recursive: true, force: true })
}
