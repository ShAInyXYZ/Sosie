import { readGpus, type Gpu } from './system.ts'

/** The candidate with the most free memory, if it has at least `minFreeMb`. Candidates are physical indices in preference order. */
export function pickGpu(gpus: Gpu[], candidates: number[], minFreeMb: number): Gpu | null {
  const pool = gpus.filter((gpu) => candidates.includes(gpu.index) && gpu.freeMb >= minFreeMb)
  if (!pool.length) return null
  return pool.sort((a, b) => b.freeMb - a.freeMb || candidates.indexOf(a.index) - candidates.indexOf(b.index))[0]
}

export async function pickFreeGpu(candidates: number[], minFreeMb: number): Promise<Gpu> {
  const gpus = await readGpus()
  if (!gpus) throw new Error("Can't read GPU memory (nvidia-smi didn't answer)")
  const gpu = pickGpu(gpus, candidates, minFreeMb)
  if (!gpu) {
    const best = gpus.filter((g) => candidates.includes(g.index)).sort((a, b) => b.freeMb - a.freeMb)[0]
    throw new Error(`No GPU with ${(minFreeMb / 1024).toFixed(1)} GB free (best: GPU ${best?.index} with ${((best?.freeMb ?? 0) / 1024).toFixed(1)} GB)`)
  }
  return gpu
}

/** Sample peak memory use per GPU while `work` runs. */
export async function trackPeakVram<T>(work: () => Promise<T>, everyMs = 2000): Promise<{ result: T; peakUsedMb: Record<number, number> }> {
  const peak: Record<number, number> = {}
  let stop = false
  const sampler = (async () => {
    while (!stop) {
      for (const gpu of (await readGpus()) ?? []) peak[gpu.index] = Math.max(peak[gpu.index] ?? 0, gpu.usedMb)
      await new Promise((resolve) => setTimeout(resolve, everyMs))
    }
  })()
  try {
    const result = await work()
    return { result, peakUsedMb: peak }
  } finally {
    stop = true
    await sampler
  }
}
