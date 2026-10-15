export type Lamp = 'ok' | 'down' | 'missing'

export type Gpu = { index: number; name: string; usedMb: number; totalMb: number; freeMb: number }

export type SystemStatus = {
  services: { api: Lamp; comfy: Lamp; python: Lamp }
  gpus: Gpu[] | null
  problems: { key: string; message: string }[]
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`)
  return body
}

export const api = {
  system: () => json<SystemStatus>('/api/system'),
}
