export type Lamp = 'ok' | 'down' | 'missing'

export type Gpu = { index: number; name: string; usedMb: number; totalMb: number; freeMb: number }

export type SystemStatus = {
  services: { api: Lamp; comfy: Lamp; python: Lamp }
  gpus: Gpu[] | null
  problems: { key: string; message: string }[]
}

export type Face = { id: string; name: string; kind: 'photo' | 'character'; subject: string; set: string; createdAt: string; warnings?: string[] }
export type Voice = { id: string; name: string; kind: 'clone' | 'designed'; description?: string; createdAt: string }
export type Look = { id: string; name: string; prompt: string }
export type FormatId = 'corner' | 'reel' | 'wide'
export type ScriptLine = { text: string; direction?: string }

export type QcReport = {
  pass: boolean
  lipSync?: { envelope?: { margin?: number; near?: number }; pauses?: { nearRatio?: number }; pass?: boolean }
  [key: string]: unknown
}
export type Segment = {
  index: number
  startS: number
  durationS: number
  frames: number
  text: string
  status: 'pending' | 'done' | 'flagged'
  attempts: { seed: number; seconds: number; qc: QcReport }[]
}
export type Job = {
  spec: { id: string; name: string; script: ScriptLine[]; faceId: string; voiceId: string; format: FormatId; firstSegmentOnly?: boolean }
  status: 'queued' | 'running' | 'done' | 'failed' | 'canceled'
  step: string
  progress: number
  message: string
  segments: Segment[]
  outputs?: Record<string, string>
  error?: string
  timings: Record<string, number>
  createdAt: string
}
export type JobRequest = {
  name?: string
  script: string
  faceId: string
  voiceId: string
  format: FormatId
  lora?: 'taomate' | 'turbo4'
  seed?: number
  punchIn?: boolean
  firstSegmentOnly?: boolean
  steps?: number
  size?: { width: number; height: number }
  refImageSize?: 'match' | 'max'
}
export type Settings = Pick<JobRequest, 'lora' | 'seed' | 'punchIn' | 'steps' | 'size' | 'refImageSize'>
export type ImageLora = { file: string; strength: number }
export type CharacterForm = { who: string; age?: string; hair?: string; outfit?: string; style?: 'photo' | 'anime' | '3d' }
export type SendResult = { sent: true; folderPath: string } | { sent: false; reason: string; bundle: string }

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`)
  return body
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  system: () => json<SystemStatus>('/api/system'),
  faces: () => json<{ faces: Face[] }>('/api/faces').then((r) => r.faces),
  voices: () => json<{ voices: Voice[] }>('/api/voices').then((r) => r.voices),
  looks: () => json<{ looks: Look[] }>('/api/looks').then((r) => r.looks),
  keyFrameUrl: (faceId: string) => `/api/faces/${encodeURIComponent(faceId)}/keyframe`,
  photoFace: (form: FormData) => json<Face>('/api/faces/photo', { method: 'POST', body: form }),
  imageLoras: () => json<{ loras: { file: string; steps: number }[]; default: ImageLora | null }>('/api/image-loras'),
  characters: (form: CharacterForm, look: string, format: FormatId, lora?: ImageLora | null) =>
    json<{ candidates: string[] }>('/api/faces/characters', post({ form, look, format, lora })).then((r) => r.candidates),
  candidateUrl: (candidate: string) => `/api/candidates/${candidate}`,
  chooseCharacter: (candidate: string, name: string) => json<Face>('/api/faces/characters/choose', post({ candidate, name })),
  importVoice: (form: FormData) => json<Voice>('/api/voices/import', { method: 'POST', body: form }),
  designVoice: (name: string, description: string) => json<Voice>('/api/voices/design', post({ name, description })),
  writeScript: (context: string, brief: string) => json<{ script: string }>('/api/script/write', post({ context, brief })),
  jobs: () => json<{ jobs: Job[] }>('/api/jobs').then((r) => r.jobs),
  job: (id: string) => json<Job>(`/api/jobs/${encodeURIComponent(id)}`),
  startJob: (request: JobRequest) => json<Job>('/api/jobs', post(request)),
  cancelJob: (id: string) => json<Job>(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reroll: (id: string, segment: number) => json<Job>(`/api/jobs/${encodeURIComponent(id)}/reroll`, post({ segment })),
  resume: (id: string) => json<Job>(`/api/jobs/${encodeURIComponent(id)}/resume`, post({})),
  send: (id: string) => json<SendResult>(`/api/jobs/${encodeURIComponent(id)}/send`, post({})),
  fileUrl: (id: string, name: string) => `/api/jobs/${encodeURIComponent(id)}/files/${name}`,
  trash: (kind: 'faces' | 'voices' | 'videos', id: string) => json<{ ok: true }>(`/api/library/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
