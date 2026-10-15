import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/** Repository root; every relative path Sosie uses is resolved against it. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const port = z.number().int().min(1024).max(65535)
const gpu = z.number().int().min(0).max(15)

export const configSchema = z.object({
  ports: z.object({ web: port, api: port, comfy: port }),
  paths: z.object({
    modelStore: z.string(),
    nasModels: z.string(),
    nasTts: z.string(),
    breezeModel: z.string(),
    /** The official dots-studio/dots.tts-soar folder; empty = the Dots voice engine is off. */
    dotsModel: z.string().default(''),
    whisperModel: z.string(),
    importVoiceSample: z.string(),
    importVoiceTranscript: z.string(),
  }),
  gpus: z.object({
    h3: z.object({
      dit: gpu,
      ditDonor: gpu,
      ditDonorGb: z.number().positive(),
      textEncoder: gpu,
      textEncoderGb: z.number().positive(),
      vae: gpu,
    }),
    image: z.array(gpu).min(1),
    tts: z.array(gpu).min(1),
    ttsMinFreeGb: z.number().positive(),
  }),
  comfy: z.object({ flags: z.array(z.string()) }),
  /** Optional: another ComfyUI on this machine, which the System panel can ask to free its VRAM. */
  mainComfyUrl: z.url(),
  moceanxUrl: z.url().default('http://127.0.0.1:3001'),
  loras: z.object({ qwenImage21: z.array(z.string()) }),
  /** Where "Check for updates" looks: the official repository and branch (fast-forward only). */
  update: z.object({ repo: z.string().min(1), branch: z.string().min(1) }).default({ repo: 'https://github.com/ShAInyXYZ/Sosie.git', branch: 'main' }),
})

export type SosieConfig = z.infer<typeof configSchema>

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Drop documentation keys ("$comment") so they never reach the schema. */
function clean(value: Json): Json {
  if (Array.isArray(value)) return value.map(clean)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith('$'))
        .map(([key, child]) => [key, clean(child)]),
    )
  }
  return value
}

/** Objects merge key by key; arrays and scalars from the local file replace the defaults. */
export function merge(base: Json, local: Json): Json {
  if (
    base && local && typeof base === 'object' && typeof local === 'object' &&
    !Array.isArray(base) && !Array.isArray(local)
  ) {
    const out: { [key: string]: Json } = { ...base }
    for (const [key, value] of Object.entries(local)) out[key] = key in base ? merge(base[key], value) : value
    return out
  }
  return local === undefined ? base : local
}

function readJson(file: string): Json {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Json
  } catch (error) {
    throw new Error(`Can't read ${file}: ${(error as Error).message}`)
  }
}

export function loadConfig(dir = join(ROOT, 'config')): SosieConfig {
  const example = clean(readJson(join(dir, 'sosie.example.json')))
  const localFile = join(dir, 'sosie.local.json')
  const local = existsSync(localFile) ? clean(readJson(localFile)) : {}
  const parsed = configSchema.safeParse(merge(example, local))
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`Invalid Sosie config:\n${issues.join('\n')}`)
  }
  return parsed.data
}

export type ConfigProblem = { key: string; message: string }

/** What the System panel shows: required paths that are empty or don't exist. */
export function configProblems(config: SosieConfig): ConfigProblem[] {
  const required: (keyof SosieConfig['paths'])[] = ['modelStore', 'breezeModel', 'whisperModel']
  const problems: ConfigProblem[] = []
  for (const key of required) {
    const value = config.paths[key]
    if (!value) problems.push({ key: `paths.${key}`, message: 'Not set in config/sosie.local.json' })
    else if (!isAbsolute(value)) problems.push({ key: `paths.${key}`, message: 'Must be an absolute path' })
    else if (!existsSync(value)) problems.push({ key: `paths.${key}`, message: `Not found: ${value}` })
  }
  const ports = Object.entries(config.ports)
  const seen = new Map<number, string>()
  for (const [name, value] of ports) {
    if (seen.has(value)) problems.push({ key: `ports.${name}`, message: `Same port as ports.${seen.get(value)}` })
    seen.set(value, name)
  }
  if (config.ports.comfy === Number(new URL(config.mainComfyUrl).port || 80)) problems.push({ key: 'ports.comfy', message: `Same port as the other ComfyUI (${config.mainComfyUrl})` })
  return problems
}
