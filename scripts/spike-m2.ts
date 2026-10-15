// Lip-sync spike: one designed-voice line → one H3 Ref2VA segment per speed LoRA (VEDA on) → trim, mux, QC.
// Usage: npx tsx scripts/spike-m2.ts   (Sosie's ComfyUI must be running: scripts/start.sh comfy)
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComfyClient } from '../server/comfy/client.ts'
import { comfyDevice } from '../server/comfy/devices.ts'
import { fill, loadTemplate } from '../server/comfy/template.ts'
import { ROOT, loadConfig } from '../server/config.ts'
import { pickFreeGpu, trackPeakVram } from '../server/gpus.ts'
import { countFrames, probeDuration, referenceAudio, trimAndMux } from '../server/media/ffmpeg.ts'
import { talkPrompt } from '../server/pipeline/prompt.ts'
import { FPS, framesFor, renderLength } from '../server/pipeline/segments.ts'
import { runPy } from '../server/py.ts'

const config = loadConfig()
const comfy = new ComfyClient(`http://127.0.0.1:${config.ports.comfy}`)
const io = join(ROOT, 'data', 'comfy-io')
const spike = join(ROOT, 'data', 'spike')
const media = join(ROOT, 'docs', 'media')
mkdirSync(join(io, 'input', 'sosie', 'spike'), { recursive: true })
mkdirSync(media, { recursive: true })

const SUBJECT = 'a friendly man in his early thirties with short dark hair, a neat short beard and a charcoal hoodie'
const SET = 'a cosy home office with a bookshelf and a warm desk lamp, softly out of focus'
const LINE = "Okay, so here's the thing nobody tells you about local video models: the trick isn't the model, it's how you feed it your voice."
const VOICE = join(spike, 'voice-design', '01.wav')

const LORAS = [
  { name: 'taomate', file: 'taomate_h3_3step_comfy.safetensors', steps: 3 },
  { name: 'turbo4', file: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors', steps: 4 },
]

if (!(await comfy.alive())) throw new Error('Sosie ComfyUI is not running (scripts/start.sh comfy)')
if (!existsSync(VOICE)) throw new Error(`missing ${VOICE} (run py/tts.py first)`)

// 1. key frame (Qwen Image 2.1), made once
const keyFrame = join(io, 'input', 'sosie', 'spike', 'keyframe.png')
if (!existsSync(keyFrame)) {
  const gpu = await pickFreeGpu(config.gpus.image, 16 * 1024)
  console.log(`key frame on GPU ${gpu.index}`)
  const graph = fill(loadTemplate('character'), {
    MODEL: 'qwen_image_2.1_int8_convrot.safetensors',
    TEXT_ENCODER: 'qwen3vl_8b_int8_convrot.safetensors',
    VAE: 'qwen_image_2.1_vae_bf16.safetensors',
    DEVICE: comfyDevice(gpu.index, config.gpus.h3.dit),
    PROMPT: `A photorealistic webcam still of ${SUBJECT}, sitting at his desk in ${SET}. He faces the camera directly, framed from the chest up and centred, mouth closed with a slight smile, eyes looking into the lens. Soft, even key light on the face, natural skin texture, sharp focus on the face. No text, no logos.`,
    NEGATIVE: 'text, watermark, logo, hands near the face, open mouth, blurry face, distorted features, extra fingers, cartoon',
    RESOLUTION: 1024,
    SEED: 20261015,
    STEPS: 30,
    OUT_PREFIX: 'sosie/spike/keyframe',
  })
  const { result, peakUsedMb } = await trackPeakVram(() => comfy.run(graph))
  const file = result.files.find((f) => f.filename.endsWith('.png'))
  if (!file) throw new Error('Qwen Image produced no image')
  copyFileSync(join(io, 'output', file.subfolder, file.filename), keyFrame)
  copyFileSync(keyFrame, join(media, 'm2-keyframe.png'))
  console.log(`key frame ${result.seconds.toFixed(0)} s, peak VRAM ${JSON.stringify(peakUsedMb)}`)
}
await comfy.free()

// 2. segment audio on the H3 grid
const duration = await probeDuration(VOICE)
const frames = framesFor(duration)
const length = renderLength(frames)
const refAudio = join(io, 'input', 'sosie', 'spike', 'seg01.wav')
await referenceAudio(VOICE, refAudio, 0, duration, length / FPS)
console.log(`line ${duration.toFixed(3)} s → ${frames} frames shown, ${length} rendered`)

// 3. one segment per speed LoRA, VEDA on
const { dit, ditDonor, ditDonorGb, textEncoder, textEncoderGb, vae } = config.gpus.h3
const dev = (physical: number) => comfyDevice(physical, dit)
const report: Record<string, unknown>[] = []
for (const lora of LORAS) {
  const graph = fill(loadTemplate('talk_segment'), {
    MODEL: 'Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors',
    TEXT_ENCODER: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
    VIDEO_VAE: 'minimax_h3_video_vae_int8_convrot.safetensors',
    AUDIO_VAE: 'minimax_h3_audio_vae_fp32.safetensors',
    LORA: lora.file,
    LORA_STRENGTH: 1,
    VEDA_PREDICTOR: 'minimax_h3_r2va_veda_preview_fp8.safetensors',
    KEY_FRAME: 'sosie/spike/keyframe.png',
    AUDIO: 'sosie/spike/seg01.wav',
    PROMPT: talkPrompt({ subject: SUBJECT, set: SET, text: LINE }),
    WIDTH: 640,
    HEIGHT: 640,
    LENGTH: length,
    REF_IMAGE_SIZE: 'match',
    SEED: 4242,
    STEPS: lora.steps,
    DIT_DEVICE: dev(dit),
    DIT_DONOR_DEVICE: dev(ditDonor),
    DIT_ALLOCATIONS: `${dev(dit)},0.5gb;${dev(ditDonor)},${ditDonorGb}gb;cpu,*`,
    TE_DEVICE: dev(textEncoder),
    TE_ALLOCATIONS: `${dev(textEncoder)},${textEncoderGb}gb;cpu,*`,
    VAE_DEVICE: dev(vae),
    OUT_PREFIX: `sosie/spike/m2-${lora.name}`,
  })
  console.log(`H3 ${lora.name} (${lora.steps} steps)…`)
  const { result, peakUsedMb } = await trackPeakVram(() => comfy.run(graph))
  const file = result.files.find((f) => f.filename.endsWith('.mp4'))
  if (!file) throw new Error(`H3 ${lora.name} produced no video`)
  const raw = join(io, 'output', file.subfolder, file.filename)
  const out = join(media, `m2-${lora.name}.mp4`)
  await trimAndMux(raw, VOICE, frames, FPS, out)
  const qcOut = join(spike, `m2-${lora.name}-qc.json`)
  await runPy('qc', { video: out, audio: VOICE, frames, landmarker: join(ROOT, 'py', 'models', 'face_landmarker.task'), out: qcOut }, { gpu: null, workDir: spike })
  const qc = JSON.parse((await import('node:fs')).readFileSync(qcOut, 'utf8'))
  const entry = { lora: lora.name, steps: lora.steps, seconds: Math.round(result.seconds), renderedFrames: length, shownFrames: await countFrames(out), peakUsedMb, qc }
  report.push(entry)
  console.log(JSON.stringify(entry))
  await comfy.free()
}

writeFileSync(join(spike, 'm2-report.json'), JSON.stringify({ line: LINE, duration, frames, length, report }, null, 1))
console.log('done → data/spike/m2-report.json')
