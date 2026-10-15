import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { trimAndMux } from '../server/media/ffmpeg.ts'
import { joinSegments } from '../server/pipeline/job.ts'

const dir = mkdtempSync(join(tmpdir(), 'sosie-media-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const ff = (...args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
const streams = (file: string) => Object.fromEntries((JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,duration,nb_frames', '-of', 'json', file], { encoding: 'utf8' })).streams as { codec_type: string; duration: string; nb_frames: string }[])
  .map((s) => [s.codec_type, { seconds: Number(s.duration), frames: Number(s.nb_frames) }]))

describe('trim, mux and join keep the whole voice (the audio was cut short by an output -frames:v)', () => {
  test('a trimmed segment has exactly n frames and all n/24 s of its audio', async () => {
    const raw = join(dir, 'raw.mp4')
    const voice = join(dir, 'voice.wav')
    ff('-f', 'lavfi', '-i', 'testsrc2=s=320x320:r=24:d=10.125', '-frames:v', '243', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', raw)
    ff('-f', 'lavfi', '-i', 'sine=f=300:d=9.7:sample_rate=24000', voice)
    const out = join(dir, 'segment.mp4')
    await trimAndMux(raw, voice, 233, 24, out)
    const s = streams(out)
    expect(s.video.frames).toBe(233)
    expect(Math.abs(s.audio.seconds - 233 / 24)).toBeLessThan(1 / 24)
  }, 60_000)

  test('the joined video carries the full voice track to its last frame', async () => {
    const parts = [0, 1].map((i) => {
      const file = join(dir, `part-${i}.mp4`)
      ff('-f', 'lavfi', '-i', `testsrc2=s=320x320:r=24:d=5`, '-frames:v', '120', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file)
      return file
    })
    const voice = join(dir, 'voice-10s.wav')
    ff('-f', 'lavfi', '-i', 'sine=f=300:d=10:sample_rate=24000', voice)
    const out = join(dir, 'joined.mp4')
    await joinSegments(parts, voice, 240, out, true, { width: 320, height: 320 })
    const s = streams(out)
    expect(s.video.frames).toBe(240)
    expect(Math.abs(s.audio.seconds - 10)).toBeLessThan(1 / 24)
  }, 60_000)
})
