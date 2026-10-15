import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './config.ts'

export type PyTool = 'tts' | 'align' | 'qc'

/**
 * Run one of Sosie's one-shot Python tools (py/<tool>.py) with a JSON request file.
 * `gpu` pins the process to one physical card (null = CPU only). Offline by default.
 */
export function runPy(tool: PyTool, request: object, opts: { gpu: number | null; workDir: string; onLine?: (line: string) => void }): Promise<string[]> {
  mkdirSync(opts.workDir, { recursive: true })
  const requestFile = join(opts.workDir, `${tool}-request.json`)
  writeFileSync(requestFile, JSON.stringify(request, null, 1))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CUDA_DEVICE_ORDER: 'PCI_BUS_ID',
    CUDA_VISIBLE_DEVICES: opts.gpu === null ? '' : String(opts.gpu),
    HF_HOME: join(ROOT, 'data', 'hf'),
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    HF_HUB_DISABLE_TELEMETRY: '1',
    PYTORCH_CUDA_ALLOC_CONF: 'expandable_segments:True',
  }
  return new Promise((resolve, reject) => {
    const child = spawn(join(ROOT, 'py', '.venv', 'bin', 'python'), [join(ROOT, 'py', `${tool}.py`), requestFile], { env, cwd: ROOT })
    const lines: string[] = []
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter(Boolean)) {
        lines.push(line)
        opts.onLine?.(line)
      }
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(lines)
      else reject(new Error(`py/${tool}.py exited ${code}: ${stderr.trim().split('\n').slice(-4).join(' | ')}`))
    })
  })
}
