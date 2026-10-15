import type { SosieConfig } from '../config.ts'
import { comfyDevice } from '../comfy/devices.ts'
import { fill, loadTemplate, type Graph } from '../comfy/template.ts'

export type SpeedLora = 'taomate' | 'turbo4'

export const SPEED_LORAS: Record<SpeedLora, { file: string; steps: number }> = {
  taomate: { file: 'taomate_h3_3step_comfy.safetensors', steps: 3 },
  turbo4: { file: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors', steps: 4 },
}

export const H3_MODELS = {
  model: 'Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors',
  textEncoder: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
  videoVae: 'minimax_h3_video_vae_fp16.safetensors',
  audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
  veda: 'minimax_h3_r2va_veda_preview_fp8.safetensors',
}

export const FORMATS = {
  corner: { width: 768, height: 768 },
  reel: { width: 576, height: 1024 },
  wide: { width: 1024, height: 576 },
} as const

export type Format = keyof typeof FORMATS

/** The talking-segment graph with every device written as ComfyUI sees it (see comfy/devices.ts). */
export function talkGraph(config: SosieConfig, input: {
  keyFrame: string // path relative to Sosie's ComfyUI input folder
  audio: string // idem
  prompt: string
  format: Format
  renderFrames: number
  seed: number
  lora: SpeedLora
  outPrefix: string
  /** Advanced: sampling steps (default: the LoRA's), a size other than the format's, 'match' reference sizing (faster; default 'max'). */
  steps?: number
  size?: { width: number; height: number }
  refImageSize?: 'match' | 'max'
}): Graph {
  const { dit, ditDonor, ditDonorGb, textEncoder, textEncoderGb, vae } = config.gpus.h3
  const dev = (physical: number) => comfyDevice(physical, dit)
  const { width, height } = input.size ?? FORMATS[input.format]
  const lora = SPEED_LORAS[input.lora]
  return fill(loadTemplate('talk_segment'), {
    MODEL: H3_MODELS.model,
    TEXT_ENCODER: H3_MODELS.textEncoder,
    VIDEO_VAE: H3_MODELS.videoVae,
    AUDIO_VAE: H3_MODELS.audioVae,
    LORA: lora.file,
    LORA_STRENGTH: 1,
    VEDA_PREDICTOR: H3_MODELS.veda,
    KEY_FRAME: input.keyFrame,
    AUDIO: input.audio,
    PROMPT: input.prompt,
    WIDTH: width,
    HEIGHT: height,
    LENGTH: input.renderFrames,
    REF_IMAGE_SIZE: input.refImageSize ?? 'max',
    SEED: input.seed,
    STEPS: input.steps ?? lora.steps,
    DIT_DEVICE: dev(dit),
    DIT_DONOR_DEVICE: dev(ditDonor),
    DIT_ALLOCATIONS: `${dev(dit)},0.5gb;${dev(ditDonor)},${ditDonorGb}gb;cpu,*`,
    TE_DEVICE: dev(textEncoder),
    TE_ALLOCATIONS: `${dev(textEncoder)},${textEncoderGb}gb;cpu,*`,
    VAE_DEVICE: dev(vae),
    OUT_PREFIX: input.outPrefix,
  })
}

/** Free VRAM H3 needs on each card before a job starts (MB): DiT activations, donor weights, text encoder, VAE. */
export function h3VramNeeds(config: SosieConfig): Record<number, number> {
  const { dit, ditDonor, ditDonorGb, textEncoder, textEncoderGb } = config.gpus.h3
  const needs: Record<number, number> = {}
  const add = (gpu: number, mb: number) => (needs[gpu] = (needs[gpu] ?? 0) + mb)
  add(dit, 14.5 * 1024) // compute card: 0.5 GB of weights + activations + the fp16 VAE (measured 14.4 GB peak at 768², full-detail reference)
  add(ditDonor, (ditDonorGb + 0.5) * 1024)
  add(textEncoder, (textEncoderGb + 1.5) * 1024)
  return needs
}
