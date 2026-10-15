import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ROOT, configProblems, type ConfigProblem, type SosieConfig } from './config.ts'

const run = promisify(execFile)

export type Lamp = 'ok' | 'down' | 'missing'

export type Gpu = { index: number; name: string; usedMb: number; totalMb: number; freeMb: number }

export type SystemStatus = {
  services: { api: Lamp; comfy: Lamp; python: Lamp }
  gpus: Gpu[] | null
  problems: ConfigProblem[]
}

/** Parse `nvidia-smi --query-gpu=index,name,memory.used,memory.total,memory.free --format=csv,noheader,nounits`. */
export function parseGpus(csv: string): Gpu[] {
  return csv
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [index, name, used, total, free] = line.split(',').map((part) => part.trim())
      return { index: Number(index), name, usedMb: Number(used), totalMb: Number(total), freeMb: Number(free) }
    })
    .filter((gpu) => Number.isInteger(gpu.index) && Number.isFinite(gpu.freeMb))
}

export async function readGpus(): Promise<Gpu[] | null> {
  try {
    const { stdout } = await run(
      'nvidia-smi',
      ['--query-gpu=index,name,memory.used,memory.total,memory.free', '--format=csv,noheader,nounits'],
      { timeout: 4000, env: { ...process.env, CUDA_DEVICE_ORDER: 'PCI_BUS_ID' } },
    )
    return parseGpus(stdout)
  } catch {
    return null // unknown, never zero
  }
}

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) })
    return response.ok
  } catch {
    return false
  }
}

export async function systemStatus(config: SosieConfig): Promise<SystemStatus> {
  const comfyInstalled = existsSync(join(ROOT, 'comfy', 'ComfyUI', 'main.py'))
  const pythonInstalled = existsSync(join(ROOT, 'py', '.venv', 'bin', 'python'))
  const [comfyUp, gpus] = await Promise.all([
    comfyInstalled ? reachable(`http://127.0.0.1:${config.ports.comfy}/system_stats`) : Promise.resolve(false),
    readGpus(),
  ])
  return {
    services: {
      api: 'ok',
      comfy: !comfyInstalled ? 'missing' : comfyUp ? 'ok' : 'down',
      python: pythonInstalled ? 'ok' : 'missing',
    },
    gpus,
    problems: configProblems(config),
  }
}
