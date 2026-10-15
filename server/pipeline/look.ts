import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ComfyClient } from '../comfy/client.ts'
import { comfyDevice } from '../comfy/devices.ts'
import { fill, loadTemplate } from '../comfy/template.ts'
import { ROOT, type SosieConfig } from '../config.ts'
import { pickFreeGpu } from '../gpus.ts'
import { runPy } from '../py.ts'
import { saveFace, type Face } from './faces.ts'
import type { Format } from './h3.ts'

/** Set presets: words only describe the place; the person is added separately. */
export const LOOKS = [
  { id: 'home-office', name: 'Home office', prompt: 'a cosy home office with a wooden desk, a bookshelf with plants and a warm desk lamp, soft daylight from a window' },
  { id: 'gaming-room', name: 'Gaming room', prompt: 'a gaming room with RGB LED strips, acoustic foam panels and a microphone arm, dim blue and purple ambient light' },
  { id: 'studio-desk', name: 'Studio desk', prompt: 'a minimal creator studio with a softbox light, a matte grey wall and a small plant, clean and modern' },
  { id: 'podcast', name: 'Podcast', prompt: 'a podcast studio with acoustic panels and warm practical lights' },
  { id: 'neon', name: 'Neon', prompt: 'a dark room with pink and cyan neon signs on a brick wall, moody light' },
  { id: 'plain', name: 'Plain colour', prompt: 'a plain seamless backdrop in soft mid grey' },
] as const

export type LookId = (typeof LOOKS)[number]['id']

/** Key frame size per format (Qwen Image 2.1 renders at multiples of 32). */
export const KEY_FRAME_SIZE: Record<Format, { width: number; height: number }> = {
  corner: { width: 1024, height: 1024 },
  reel: { width: 768, height: 1344 },
  wide: { width: 1344, height: 768 },
}

const NEGATIVE = 'text, watermark, logo, hands near the face, open mouth, blurry face, distorted features, extra fingers, cartoon, people in the background'
const QWEN = { model: 'qwen_image_2.1_int8_convrot.safetensors', textEncoder: 'qwen3vl_8b_int8_convrot.safetensors', vae: 'qwen_image_2.1_vae_bf16.safetensors' }

export type CharacterForm = { who: string; age?: string; hair?: string; outfit?: string; style?: 'photo' | 'anime' | '3d' }

const STYLE_LINE = {
  photo: 'A photorealistic webcam still',
  anime: 'A clean anime-style illustration in the style of a webcam frame',
  '3d': 'A stylised 3D render in the style of a webcam frame',
}

export function describeCharacter(form: CharacterForm): string {
  return [form.who, form.age && `${form.age}`, form.hair && `with ${form.hair}`, form.outfit && `wearing ${form.outfit}`].filter(Boolean).join(', ')
}

export function characterPrompt(form: CharacterForm, look: string): string {
  return `${STYLE_LINE[form.style ?? 'photo']} of ${describeCharacter(form)}, sitting in ${look}. They face the camera directly, framed from the chest up and centred, mouth closed with a slight smile, eyes looking into the lens. Soft, even key light on the face, natural skin texture, sharp focus on the face. No text, no logos.`
}

export function setPrompt(look: string): string {
  return `A photorealistic eye-level webcam view of ${look}, the background behind a person sitting at a desk, with nobody in the frame, gentle depth of field. No text, no logos.`
}

export function lookText(id: string): string {
  const preset = LOOKS.find((l) => l.id === id)
  if (!preset) throw new Error(`Unknown look: ${id}`)
  return preset.prompt
}

async function qwenImage(config: SosieConfig, prompt: string, size: { width: number; height: number }, seed: number, outPrefix: string, root: string): Promise<string> {
  const comfy = new ComfyClient(`http://127.0.0.1:${config.ports.comfy}`)
  if (!(await comfy.alive())) throw new Error("Sosie's ComfyUI is not running. Start services from the System panel.")
  const gpu = await pickFreeGpu(config.gpus.image, 16 * 1024)
  const graph = fill(loadTemplate('character'), {
    MODEL: QWEN.model, TEXT_ENCODER: QWEN.textEncoder, VAE: QWEN.vae,
    DEVICE: comfyDevice(gpu.index, config.gpus.h3.dit),
    PROMPT: prompt, NEGATIVE, RESOLUTION: 1024, HALF_WIDTH: size.width / 2, HALF_HEIGHT: size.height / 2,
    SEED: seed, STEPS: 30, OUT_PREFIX: outPrefix,
  })
  const result = await comfy.run(graph)
  const file = result.files.find((f) => f.filename.endsWith('.png'))
  if (!file) throw new Error('The image model returned no image')
  return join(root, 'data', 'comfy-io', 'output', file.subfolder, file.filename)
}

/** A set image for a look and format (cached per look, format and seed). */
export async function generateSet(config: SosieConfig, lookId: LookId, format: Format, seed = 1, root = ROOT): Promise<string> {
  const dir = join(root, 'data', 'looks', lookId)
  const file = join(dir, `${format}-${seed}.png`)
  if (existsSync(file)) return file
  mkdirSync(dir, { recursive: true })
  const made = await qwenImage(config, setPrompt(lookText(lookId)), KEY_FRAME_SIZE[format], seed, `sosie/looks/${lookId}-${format}-${seed}`, root)
  copyFileSync(made, file)
  return file
}

/** Four character candidates in the chosen set. Returns image paths to choose from. */
export async function characterCandidates(config: SosieConfig, form: CharacterForm, lookId: LookId, format: Format, count = 4, root = ROOT): Promise<string[]> {
  const batch = randomUUID().slice(0, 8)
  const dir = join(root, 'data', 'candidates', batch)
  mkdirSync(dir, { recursive: true })
  const files: string[] = []
  for (let i = 0; i < count; i++) {
    const made = await qwenImage(config, characterPrompt(form, lookText(lookId)), KEY_FRAME_SIZE[format], 1000 + i * 7919 + Math.floor(Math.random() * 1000), `sosie/candidates/${batch}-${i + 1}`, root)
    const file = join(dir, `${i + 1}.png`)
    copyFileSync(made, file)
    files.push(file)
  }
  writeFileSync(join(dir, 'form.json'), JSON.stringify({ form, lookId, format }))
  return files
}

export function chooseCharacter(candidate: string, name: string, root = ROOT): Face {
  const formFile = join(candidate, '..', 'form.json')
  const { form, lookId } = JSON.parse(readFileSync(formFile, 'utf8')) as { form: CharacterForm; lookId: LookId }
  return saveFace({ keyFrame: candidate, name, kind: 'character', subject: describeCharacter(form), set: lookText(lookId), consent: true }, root)
}

/** A real photo: cut the person out (pixels kept) and place them over the set. */
export async function photoFace(config: SosieConfig, input: { photo: string; name: string; lookId: LookId; format: Format; consent: boolean; subject?: string }, root = ROOT): Promise<Face> {
  if (!input.consent) throw new Error("Confirm this is you, or that you have this person's permission.")
  const set = await generateSet(config, input.lookId, input.format, 1, root)
  const work = join(root, 'data', 'candidates', `photo-${randomUUID().slice(0, 8)}`)
  mkdirSync(work, { recursive: true })
  const gpu = await pickFreeGpu([...config.gpus.image, ...config.gpus.tts], 4 * 1024).catch(() => null)
  const size = KEY_FRAME_SIZE[input.format]
  await runPy('cutout', {
    image: input.photo, modelDir: join(config.paths.modelStore, 'RMBG', 'BiRefNet'), weights: 'BiRefNet-general.safetensors',
    outCutout: join(work, 'cutout.png'), set, outComposite: join(work, 'keyframe.png'), size: [size.width, size.height],
  }, { gpu: gpu ? gpu.index : null, workDir: work })
  return saveFace({ keyFrame: join(work, 'keyframe.png'), name: input.name, kind: 'photo', subject: input.subject ?? '', set: lookText(input.lookId), consent: true }, root)
}

export function listCandidates(root = ROOT): string[] {
  const dir = join(root, 'data', 'candidates')
  return existsSync(dir) ? readdirSync(dir) : []
}
