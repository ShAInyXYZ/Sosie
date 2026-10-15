import { describe, expect, it } from 'vitest'
import type { Word } from '../server/pipeline/captions.ts'
import { planSegments, type PlannedLine } from '../server/pipeline/plan.ts'
import { FPS, MAX_SEGMENT_FRAMES, onGrid } from '../server/pipeline/segments.ts'

/** A script of lines of given lengths (s), words every 0.35 s, pauses of 0.4 s between lines. */
function script(lengths: number[]) {
  const lines: PlannedLine[] = []
  const words: Word[] = []
  let t = 0
  lengths.forEach((length, i) => {
    lines.push({ text: `line ${i}`, startS: t, durationS: length, direction: i % 2 ? 'excited' : undefined })
    for (let w = 0; w * 0.35 + 0.3 <= length; w++) words.push({ word: `w${i}-${w}`, start: +(t + w * 0.35).toFixed(3), end: +(t + w * 0.35 + 0.28).toFixed(3) })
    t += length + 0.4
  })
  return { lines, words, totalFrames: Math.ceil((t - 0.4 + 0.3) * FPS) }
}

describe('segment plan', () => {
  it('keeps a short script in one segment', () => {
    const { lines, words, totalFrames } = script([2.5, 3.0, 3.0]) // 9.3 s ≤ 10.1 s
    const segments = planSegments(lines, words, totalFrames)
    expect(segments).toHaveLength(1)
    expect(segments[0].frames).toBe(totalFrames)
    expect(onGrid(segments[0].renderFrames)).toBe(true)
  })

  it('covers the whole track without gaps, within the frame limit, cutting between lines', () => {
    const { lines, words, totalFrames } = script([3, 4, 2.5, 5, 3, 4, 3.5, 2, 4, 3, 5, 2.5])
    const segments = planSegments(lines, words, totalFrames)
    expect(segments[0].startFrame).toBe(0)
    expect(segments.at(-1)!.endFrame).toBe(totalFrames)
    for (let i = 1; i < segments.length; i++) expect(segments[i].startFrame).toBe(segments[i - 1].endFrame)
    for (const s of segments) {
      expect(s.frames).toBeLessThanOrEqual(MAX_SEGMENT_FRAMES)
      expect(s.renderFrames).toBeGreaterThanOrEqual(s.frames)
      expect(onGrid(s.renderFrames)).toBe(true)
    }
    // every cut falls inside a pause between lines (no word straddles it)
    for (const s of segments.slice(1)) {
      const t = s.startFrame / FPS
      expect(words.some((w) => w.start < t && w.end > t)).toBe(false)
    }
  })

  it('splits one long line at a pause between its words', () => {
    const lines: PlannedLine[] = [{ text: 'long', startS: 0, durationS: 16 }]
    const words: Word[] = []
    for (let t = 0; t < 16; t += 0.35) words.push({ word: 'w', start: +t.toFixed(3), end: +(t + 0.28).toFixed(3) })
    words.splice(25, 0) // keep evenly spaced; then widen one gap around 8 s
    const i = words.findIndex((w) => w.start > 8)
    for (const w of words.slice(i)) { w.start += 0.3; w.end += 0.3 }
    const total = Math.ceil(16.6 * FPS)
    const segments = planSegments(lines, words, total)
    expect(segments.length).toBe(2)
    const cutS = segments[1].startFrame / FPS
    expect(cutS).toBeGreaterThan(words[i - 1].end)
    expect(cutS).toBeLessThan(words[i].start)
  })

  it('gives each segment its own words and the direction of its main line', () => {
    const { lines, words, totalFrames } = script([6.5, 6.5, 6.5])
    const segments = planSegments(lines, words, totalFrames)
    for (const s of segments) {
      expect(s.words.every((w) => w.start >= -0.2 && w.end <= s.durationS + 0.2)).toBe(true)
      expect(s.text.length).toBeGreaterThan(0)
    }
    expect(segments.some((s) => s.direction === 'excited')).toBe(true)
  })
})
