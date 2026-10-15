import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Word } from '../pipeline/captions.ts'
import { FORMATS } from '../pipeline/h3.ts'
import type { Engines, QcReport } from '../pipeline/job.ts'
import { FPS } from '../pipeline/segments.ts'

const run = promisify(execFile)
const ff = (...args: string[]) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])

/**
 * Stand-ins for TTS, H3 and QC that make real (tiny) media in a second or two, so the job runner,
 * the API and the Studio can be tested end to end without GPUs. `qc` decides each take's verdict.
 */
export function fakeEngines(options: { root: string; qc?: (segment: number, take: number) => boolean; secondsPerLine?: number; delayMs?: number } = { root: '' }): Engines {
  const perLine = options.secondsPerLine ?? 2
  const takes = new Map<string, number>()
  return {
    speak: async (_config, _voiceId, lines, workDir) => {
      mkdirSync(workDir, { recursive: true })
      const wav = join(workDir, 'voice.wav')
      const durationS = lines.length * perLine
      await ff('-f', 'lavfi', '-i', `sine=f=220:d=${durationS}:sample_rate=24000`, '-ac', '1', wav)
      const words: Word[] = []
      const spoken = lines.map((line, index) => {
        const startS = index * perLine
        const tokens = line.text.split(/\s+/).filter(Boolean)
        const step = (perLine - 0.4) / Math.max(1, tokens.length)
        tokens.forEach((word, i) => words.push({ word, start: startS + i * step, end: startS + (i + 1) * step }))
        return { ...line, file: wav, startS, durationS: perLine - 0.3 }
      })
      return { wav, durationS, sampleRate: 24000, lines: spoken, words }
    },
    prepare: async () => {},
    release: async () => {},
    film: async ({ renderFrames, format, outPrefix }) => {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      const { width, height } = FORMATS[format]
      const file = join(options.root, 'data', 'comfy-io', 'output', `${outPrefix}.mp4`)
      mkdirSync(join(file, '..'), { recursive: true })
      await ff('-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:r=${FPS}:d=${renderFrames / FPS}`, '-frames:v', String(renderFrames), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file)
      return file
    },
    qc: async ({ video, out, frames }) => {
      const segment = Number(/seg-(\d+)/.exec(video)?.[1] ?? 0)
      const take = (takes.get(String(segment)) ?? 0) + 1
      takes.set(String(segment), take)
      const pass = options.qc ? options.qc(segment, take) : true
      const report: QcReport = { pass, frames, lipSync: { envelope: { margin: pass ? 0.5 : 0.1 }, pass } }
      writeFileSync(out, JSON.stringify(report))
      return report
    },
  }
}
