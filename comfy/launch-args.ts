// Print the command-line arguments for Sosie's ComfyUI (used by scripts/start.sh).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, loadConfig, type SosieConfig } from '../server/config.ts'

export function launchArgs(config: SosieConfig, root = ROOT): string[] {
  const io = join(root, 'data', 'comfy-io')
  return [
    '--listen', '127.0.0.1',
    '--port', String(config.ports.comfy),
    '--input-directory', join(io, 'input'),
    '--output-directory', join(io, 'output'),
    '--temp-directory', join(io, 'temp'),
    '--user-directory', join(io, 'user'),
    '--extra-model-paths-config', join(root, 'comfy', 'extra_model_paths.yaml'),
    '--disable-auto-launch',
    ...config.comfy.flags,
  ]
}

const isMain = process.argv[1]?.endsWith('launch-args.ts')
if (isMain) {
  const config = loadConfig()
  for (const dir of ['input', 'output', 'temp', 'user']) mkdirSync(join(ROOT, 'data', 'comfy-io', dir), { recursive: true })
  console.log(launchArgs(config).join(' '))
}
