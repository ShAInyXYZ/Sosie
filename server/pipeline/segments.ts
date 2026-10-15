/** MiniMax H3 timing: 24 fps, clip lengths on a 17k + 5 frame grid, trained range ~124–362 frames. */
export const FPS = 24
export const MIN_RENDER_FRAMES = 124 // ≈ 5.2 s, the shortest trained clip
export const MAX_SEGMENT_FRAMES = 243 // ≈ 10.1 s: keeps the audio reference < 15 s and avoids VEDA's 10–15 s noise-frame bug

/** Frames needed to show `seconds` of audio, rounded up to whole frames. */
export function framesFor(seconds: number): number {
  return Math.ceil(seconds * FPS - 1e-9)
}

/** The clip length to render for a segment of `n` frames: the next 17k + 5 value, at least 124. */
export function renderLength(n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid frame count ${n}`)
  return 17 * Math.ceil((Math.max(n, MIN_RENDER_FRAMES) - 5) / 17) + 5
}

export function onGrid(frames: number): boolean {
  return frames >= 5 && (frames - 5) % 17 === 0
}

/** Seconds at a frame boundary. */
export function frameTime(frame: number): number {
  return frame / FPS
}
