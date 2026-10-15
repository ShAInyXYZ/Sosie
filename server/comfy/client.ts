import { randomUUID } from 'node:crypto'
import type { Graph } from './template.ts'

export type OutputFile = { filename: string; subfolder: string; type: string }

export type RunResult = {
  promptId: string
  seconds: number
  files: OutputFile[]
}

export class ComfyError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message)
  }
}

/** Minimal client for one ComfyUI instance (Sosie's own, never the main one). */
export class ComfyClient {
  readonly clientId = randomUUID()
  constructor(readonly base: string) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.base}${path}`, init)
    const text = await response.text()
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      /* not JSON */
    }
    if (!response.ok) throw new ComfyError(`ComfyUI ${path} answered ${response.status}`, body)
    return body as T
  }

  async alive(): Promise<boolean> {
    try {
      await this.json('/system_stats')
      return true
    } catch {
      return false
    }
  }

  async queue(graph: Graph): Promise<string> {
    const body = await this.json<{ prompt_id: string; node_errors?: Record<string, unknown> }>('/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: this.clientId }),
    })
    if (body.node_errors && Object.keys(body.node_errors).length) throw new ComfyError('ComfyUI rejected the workflow', body.node_errors)
    return body.prompt_id
  }

  /** Wait for a prompt to finish; returns every file its output nodes wrote. */
  async wait(promptId: string, { pollMs = 2000, timeoutMs = 3 * 60 * 60 * 1000, onTick }: { pollMs?: number; timeoutMs?: number; onTick?: () => void } = {}): Promise<OutputFile[]> {
    const started = Date.now()
    for (;;) {
      const history = await this.json<Record<string, HistoryEntry>>(`/history/${promptId}`)
      const entry = history[promptId]
      if (entry?.status?.completed || entry?.status?.status_str === 'error') {
        if (entry.status.status_str === 'error') {
          const message = entry.status.messages?.find(([kind]) => kind === 'execution_error')?.[1]
          throw new ComfyError(`ComfyUI failed: ${message?.exception_message ?? 'unknown error'}`, message)
        }
        return Object.values(entry.outputs ?? {}).flatMap((output) => [
          ...(output.images ?? []),
          ...(output.gifs ?? []),
          ...(output.audio ?? []),
          ...(output.videos ?? []),
        ])
      }
      if (Date.now() - started > timeoutMs) throw new ComfyError(`Timed out after ${Math.round(timeoutMs / 60000)} min`)
      onTick?.()
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }

  async run(graph: Graph, options?: Parameters<ComfyClient['wait']>[1]): Promise<RunResult> {
    const started = Date.now()
    const promptId = await this.queue(graph)
    const files = await this.wait(promptId, options)
    return { promptId, seconds: (Date.now() - started) / 1000, files }
  }

  interrupt() {
    return this.json('/interrupt', { method: 'POST' })
  }

  /** Unload models and free VRAM. */
  free() {
    return this.json('/free', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    })
  }

  async queueEmpty(): Promise<boolean> {
    const queue = await this.json<{ queue_running: unknown[]; queue_pending: unknown[] }>('/queue')
    return queue.queue_running.length === 0 && queue.queue_pending.length === 0
  }
}

type HistoryEntry = {
  status?: { completed?: boolean; status_str?: string; messages?: [string, { exception_message?: string }][] }
  outputs?: Record<string, { images?: OutputFile[]; gifs?: OutputFile[]; audio?: OutputFile[]; videos?: OutputFile[] }>
}
