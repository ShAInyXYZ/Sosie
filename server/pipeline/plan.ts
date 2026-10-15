import type { Word } from './captions.ts'
import { FPS, MAX_SEGMENT_FRAMES, renderLength } from './segments.ts'

export type PlannedLine = { text: string; direction?: string; startS: number; durationS: number }

export type Segment = {
  index: number
  /** Frames on the final timeline, [startFrame, endFrame). */
  startFrame: number
  endFrame: number
  frames: number
  /** Frames H3 renders (17k + 5, at least 124); the clip is trimmed back to `frames`. */
  renderFrames: number
  startS: number
  durationS: number
  /** Words spoken in the segment, on the segment's own timeline (for QC and the prompt). */
  words: Word[]
  text: string
  direction?: string
}

const TARGET_FRAMES = 8 * FPS
const MIN_SEGMENT_FRAMES = 6 * FPS
const MIN_TAIL_FRAMES = 3 * FPS
const MIN_WORD_GAP_S = 0.12

type Cut = { frame: number; strength: number }

/** Cut candidates: the middle of each pause between lines (strong), and of gaps between words (weak). */
export function cutCandidates(lines: PlannedLine[], words: Word[]): Cut[] {
  const cuts: Cut[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    const end = lines[i].startS + lines[i].durationS
    const next = lines[i + 1].startS
    cuts.push({ frame: Math.round(((end + next) / 2) * FPS), strength: 1000 + (next - end) })
  }
  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1].start - words[i].end
    if (gap >= MIN_WORD_GAP_S) cuts.push({ frame: Math.round(((words[i].end + words[i + 1].start) / 2) * FPS), strength: gap })
  }
  return cuts.sort((a, b) => a.frame - b.frame)
}

/** Split the voice track into H3 segments. Every cut lands inside a pause and on a frame boundary. */
export function planSegments(lines: PlannedLine[], words: Word[], totalFrames: number): Segment[] {
  const cuts = cutCandidates(lines, words)
  const bounds: number[] = [0]
  let start = 0
  while (totalFrames - start > MAX_SEGMENT_FRAMES) {
    const inRange = (min: number) => cuts.filter((c) => c.frame > start + min && c.frame <= start + MAX_SEGMENT_FRAMES)
    const lineCuts = inRange(MIN_SEGMENT_FRAMES).filter((c) => c.strength >= 1000)
    let cut: number
    if (lineCuts.length) {
      cut = lineCuts.reduce((best, c) => (Math.abs(c.frame - start - TARGET_FRAMES) < Math.abs(best.frame - start - TARGET_FRAMES) ? c : best)).frame
    } else {
      const wordCuts = inRange(2 * FPS)
      // prefer the longest pause, then the one nearest the target length
      cut = wordCuts.length
        ? wordCuts.reduce((best, c) => (c.strength > best.strength + 1e-6 || (Math.abs(c.strength - best.strength) <= 1e-6 && Math.abs(c.frame - start - TARGET_FRAMES) < Math.abs(best.frame - start - TARGET_FRAMES)) ? c : best)).frame
        : start + MAX_SEGMENT_FRAMES
    }
    // don't leave a tail too short to be worth a render when it fits in this segment
    if (totalFrames - cut < MIN_TAIL_FRAMES && totalFrames - start <= MAX_SEGMENT_FRAMES) cut = totalFrames
    bounds.push(cut)
    start = cut
  }
  bounds.push(totalFrames)

  const segments: Segment[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const startFrame = bounds[i]
    const endFrame = bounds[i + 1]
    if (endFrame <= startFrame) continue
    const startS = startFrame / FPS
    const durationS = (endFrame - startFrame) / FPS
    const inside = words.filter((w) => (w.start + w.end) / 2 >= startS && (w.start + w.end) / 2 < startS + durationS)
    const local = inside.map((w) => ({ word: w.word, start: +(w.start - startS).toFixed(3), end: +(w.end - startS).toFixed(3) }))
    // the delivery note of the line that covers most of the segment
    let direction: string | undefined
    let bestOverlap = 0
    for (const line of lines) {
      const overlap = Math.min(line.startS + line.durationS, startS + durationS) - Math.max(line.startS, startS)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        direction = line.direction || undefined
      }
    }
    segments.push({
      index: segments.length,
      startFrame,
      endFrame,
      frames: endFrame - startFrame,
      renderFrames: renderLength(endFrame - startFrame),
      startS,
      durationS,
      words: local,
      text: inside.map((w) => w.word).join(' '),
      direction,
    })
  }
  return segments
}
