/**
 * Sosie's ComfyUI runs with `--default-device <H3 compute GPU>` because VEDA's Triton kernels launch on
 * torch's *current* device; with another card current, they read the wrong memory and crash
 * ("illegal memory access"). ComfyUI implements the flag by reordering CUDA_VISIBLE_DEVICES so the
 * default card becomes cuda:0 and the others keep their order after it. Config and the UI speak in
 * physical (nvidia-smi) indices; this maps them to the `cuda:N` names ComfyUI sees.
 */
export function comfyIndex(physical: number, defaultDevice: number): number {
  if (physical === defaultDevice) return 0
  return physical < defaultDevice ? physical + 1 : physical
}

export function comfyDevice(physical: number, defaultDevice: number): string {
  return `cuda:${comfyIndex(physical, defaultDevice)}`
}
