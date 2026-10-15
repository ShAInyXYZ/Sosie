import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, type SosieConfig } from './config.ts'
import { loadJob, newJob, projectDir, rerollSegment, runJob, type Engines, type JobSpec, type JobState } from './pipeline/job.ts'

export type JobInput = Omit<JobSpec, 'id'>

/**
 * Jobs run one at a time (they share the GPUs) in the order they were asked for. State lives in
 * `data/projects/<id>/job.json`, so a restart loses nothing: a job left running resumes on request.
 */
export class JobManager {
  private chain: Promise<unknown> = Promise.resolve()
  private controllers = new Map<string, AbortController>()
  private live = new Map<string, JobState>()

  constructor(private config: SosieConfig, private options: { root?: string; engines?: Engines } = {}) {}

  private get root() {
    return this.options.root ?? ROOT
  }

  get(id: string): JobState | null {
    return this.live.get(id) ?? loadJob(id, this.root)
  }

  list(): JobState[] {
    const dir = join(this.root, 'data', 'projects')
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .map((id) => this.get(id))
      .filter((job): job is JobState => !!job)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  start(input: JobInput): JobState {
    const spec: JobSpec = { ...input, id: randomUUID() }
    return this.enqueue(spec)
  }

  /** Run a saved job again from where it stopped (after a crash, a cancel or a re-roll). */
  resume(id: string): JobState {
    const job = this.get(id)
    if (!job) throw new JobError('No such video.', 404)
    if (this.controllers.has(id)) return job
    return this.enqueue(job.spec)
  }

  reroll(id: string, index: number): JobState {
    if (this.controllers.has(id)) throw new JobError('Wait for this video to finish, then re-roll.', 409)
    try {
      rerollSegment(id, index, this.root)
    } catch (error) {
      throw new JobError((error as Error).message, 404)
    }
    return this.enqueue(this.get(id)!.spec)
  }

  cancel(id: string): JobState | null {
    this.controllers.get(id)?.abort()
    return this.get(id)
  }

  private enqueue(spec: JobSpec): JobState {
    const controller = new AbortController()
    this.controllers.set(spec.id, controller)
    const queued = { ...(loadJob(spec.id, this.root) ?? newJob(spec)), status: 'queued' as const, message: 'Waiting for the GPU' }
    this.live.set(spec.id, queued)
    this.chain = this.chain.then(async () => {
      if (controller.signal.aborted) {
        this.live.set(spec.id, { ...queued, status: 'canceled', message: 'Canceled' })
        return
      }
      await runJob(this.config, spec, {
        root: this.root, engines: this.options.engines, signal: controller.signal,
        onUpdate: (state) => this.live.set(spec.id, structuredClone(state)),
      })
    }).catch(() => undefined).finally(() => {
      this.controllers.delete(spec.id)
      this.live.delete(spec.id) // job.json now holds the final state
    })
    return queued
  }

  /**
   * Run other GPU work (a new character, a photo cut-out, a designed voice) in the same line as the
   * videos: two models loading at once on one card ran it out of memory.
   */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task)
    this.chain = result.catch(() => undefined)
    return result
  }

  /** Files a finished job may serve, by bundle name. */
  file(id: string, name: string): string | null {
    const job = this.get(id)
    const outputs = job?.outputs
    if (!outputs) return null
    const files: Record<string, string> = {
      'facecam.mp4': outputs.video, 'captions.srt': outputs.captions, 'words.json': outputs.words,
      'project.json': outputs.project, 'poster.jpg': outputs.poster,
      ...(outputs.qcHtml ? { 'qc.html': outputs.qcHtml } : {}),
    }
    const file = files[name]
    return file && file.startsWith(projectDir(id, this.root)) && existsSync(file) ? file : null
  }
}

export class JobError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}
