import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createApp } from '../server/app.ts'
import { JobManager } from '../server/jobs.ts'
import { ROOT, configSchema } from '../server/config.ts'
import type { JobState } from '../server/pipeline/job.ts'
import { fakeEngines } from '../server/testing/fake-engines.ts'

// The job lifecycle over HTTP with fake engines: start, progress, result files, re-roll, cancel, resume.
const root = mkdtempSync(join(tmpdir(), 'sosie-api-'))
const config = configSchema.parse(JSON.parse(readFileSync(join(ROOT, 'config', 'sosie.example.json'), 'utf8')))
let base = ''
let close = () => {}

beforeAll(async () => {
  for (const [kind, id, meta] of [
    ['faces', 'face-1', { id: 'face-1', name: 'Alex', kind: 'character', subject: 'a presenter', set: 'a home office', consent: true, createdAt: '2026-10-15T00:00:00Z' }],
    ['voices', 'voice-1', { id: 'voice-1', name: 'Narrator', kind: 'designed', consent: true, createdAt: '2026-10-15T00:00:00Z' }],
  ] as const) {
    const dir = join(root, 'data', kind, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, kind === 'faces' ? 'face.json' : 'voice.json'), JSON.stringify(meta))
  }
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64', '-frames:v', '1', join(root, 'data', 'faces', 'face-1', 'keyframe.png')])
  // segment 2's first two takes fail (the automatic re-roll included), so it is flagged once
  const engines = fakeEngines({ root, qc: (segment, take) => !(segment === 2 && take <= 2) })
  const app = createApp(config, { root, jobs: new JobManager(config, { root, engines }) })
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => server.close()
})
afterAll(() => {
  close()
  rmSync(root, { recursive: true, force: true })
})

const call = async <T>(path: string, init?: RequestInit) => {
  const response = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } })
  return { status: response.status, body: (await response.json()) as T }
}
const until = async (id: string, done: (job: JobState) => boolean) => {
  for (let i = 0; i < 600; i++) {
    const { body } = await call<JobState>(`/api/jobs/${id}`)
    if (done(body)) return body
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timed out')
}

describe('jobs over HTTP (fake engines)', () => {
  test('a job needs a script, a face and a voice', async () => {
    expect((await call('/api/jobs', { method: 'POST', body: JSON.stringify({ script: '', faceId: 'face-1', voiceId: 'voice-1' }) })).status).toBe(400)
    const { status, body } = await call<{ error: string }>('/api/jobs', { method: 'POST', body: JSON.stringify({ script: 'Hi.', faceId: 'nope', voiceId: 'voice-1' }) })
    expect(status).toBe(400)
    expect(body.error).toBe('Choose a face first.')
  })

  test('start → done with a bundle; a flagged segment is re-rolled and the video joined again', async () => {
    const script = ['Hello there, this is the first line.', 'The second line follows it. [calm]', 'A third line keeps going.', 'Then a fourth one.', 'The fifth line is here.', 'And a sixth line to finish.'].join('\n')
    const { status, body: queued } = await call<JobState>('/api/jobs', { method: 'POST', body: JSON.stringify({ script, faceId: 'face-1', voiceId: 'voice-1', format: 'corner' }) })
    expect(status).toBe(201)
    expect(queued.spec.script[1]).toEqual({ text: 'The second line follows it.', direction: 'calm' })
    const done = await until(queued.spec.id, (job) => job.status === 'done' || job.status === 'failed')
    expect(done.status).toBe('done')
    expect(done.segments.length).toBeGreaterThan(0)
    const project = JSON.parse(await (await fetch(`${base}/api/jobs/${queued.spec.id}/files/project.json`)).text())
    expect(project).toMatchObject({ bundleVersion: 1, aiGenerated: true })
    expect(JSON.stringify(project)).not.toContain(root) // no local paths leave the machine
    expect((await fetch(`${base}/api/jobs/${queued.spec.id}/files/facecam.mp4`)).headers.get('content-type')).toContain('video/mp4')
    expect((await fetch(`${base}/api/jobs/${queued.spec.id}/files/../job.json`)).status).toBe(404)

    expect(done.segments.map((segment) => segment.status)).toEqual(['done', 'flagged'])
    expect(done.message).toBe('Done — some segments need a look')
    const { body: again } = await call<JobState>(`/api/jobs/${queued.spec.id}/reroll`, { method: 'POST', body: JSON.stringify({ segment: 2 }) })
    expect(again.status).toBe('queued')
    const rerolled = await until(queued.spec.id, (job) => job.status === 'done' && job.segments[1].status !== 'pending')
    expect(rerolled.segments[1].status).toBe('done')
    expect(rerolled.segments[1].attempts).toHaveLength(3)
  }, 60_000)

  test('cancel stops a job; resume finishes it', async () => {
    const script = Array.from({ length: 8 }, (_, i) => `Line number ${i + 1} of a longer script.`).join('\n')
    const { body: queued } = await call<JobState>('/api/jobs', { method: 'POST', body: JSON.stringify({ script, faceId: 'face-1', voiceId: 'voice-1' }) })
    await until(queued.spec.id, (job) => job.step === 'h3')
    await call(`/api/jobs/${queued.spec.id}`, { method: 'DELETE' })
    const canceled = await until(queued.spec.id, (job) => job.status === 'canceled')
    expect(canceled.message).toBe('Canceled')
    await call(`/api/jobs/${queued.spec.id}/resume`, { method: 'POST' })
    const resumed = await until(queued.spec.id, (job) => job.status === 'done')
    expect(resumed.segments.map((segment) => segment.status)).toEqual(resumed.segments.map(() => 'done'))
    expect(existsSync(JSON.parse(readFileSync(join(root, 'data', 'projects', queued.spec.id, 'job.json'), 'utf8')).outputs.video)).toBe(true)
  }, 60_000)
})
