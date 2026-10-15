import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

async function ffmpeg(args: string[]) {
  try {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 16 * 1024 * 1024 })
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? ''
    throw new Error(`ffmpeg failed: ${stderr.trim().split('\n').slice(-3).join(' | ') || (error as Error).message}`)
  }
}

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  const seconds = Number(stdout.trim())
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe couldn't read the duration of ${file}`)
  return seconds
}

export async function countFrames(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file])
  return Number(stdout.trim())
}

/** Cut [start, start+seconds) from a track, silence-pad it to `padTo` seconds, resample for H3 (32 kHz stereo). */
export async function referenceAudio(src: string, dst: string, start: number, seconds: number, padTo: number) {
  await ffmpeg([
    '-i', src,
    '-af', `atrim=start=${start.toFixed(6)}:duration=${seconds.toFixed(6)},asetpts=PTS-STARTPTS,apad=whole_dur=${padTo.toFixed(6)},atrim=duration=${padTo.toFixed(6)}`,
    '-ar', '32000', '-ac', '2', '-c:a', 'pcm_s16le', dst,
  ])
}

/** Cut [start, start+seconds) from a track at its own sample rate (the exact audio a segment shows). */
export async function cutAudio(src: string, dst: string, start: number, seconds: number) {
  await ffmpeg(['-i', src, '-af', `atrim=start=${start.toFixed(6)}:duration=${seconds.toFixed(6)},asetpts=PTS-STARTPTS`, '-c:a', 'pcm_s16le', dst])
}

/** Keep the first `frames` frames of a rendered clip and lay the given audio under it. */
export async function trimAndMux(video: string, audio: string, frames: number, fps: number, out: string) {
  const seconds = frames / fps
  await ffmpeg([
    '-i', video, '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0',
    // cut the picture with a filter: an output -frames:v limit ends the file before the audio is written
    '-vf', `trim=end_frame=${frames},setpts=PTS-STARTPTS`,
    '-af', `apad=whole_dur=${seconds.toFixed(6)},atrim=duration=${seconds.toFixed(6)}`,
    '-c:v', 'libx264', '-crf', '10', '-preset', 'slow', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-metadata', 'comment=AI-generated (Sosie)',
    '-movflags', '+faststart', out,
  ])
}

/** Pad/trim a mono or stereo track to exact seconds (the joined voice track, for the final mux). */
export async function exactLength(src: string, dst: string, seconds: number) {
  await ffmpeg(['-i', src, '-af', `apad=whole_dur=${seconds.toFixed(6)},atrim=duration=${seconds.toFixed(6)}`, '-c:a', 'pcm_s16le', dst])
}
