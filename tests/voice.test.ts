import { describe, expect, it } from 'vitest'
import { captionLines, shiftWords, toSrt, type Word } from '../server/pipeline/captions.ts'
import { lineKey, pauseAfter } from '../server/pipeline/voice.ts'

const words = (text: string, start = 0, step = 0.3): Word[] =>
  text.split(' ').map((word, i) => ({ word, start: +(start + i * step).toFixed(3), end: +(start + i * step + step * 0.8).toFixed(3) }))

describe('captions', () => {
  it('breaks lines at sentence ends', () => {
    const lines = captionLines([...words('Hello there.'), ...words('How are you?', 1)])
    expect(lines.map((l) => l.text)).toEqual(['Hello there.', 'How are you?'])
  })

  it('breaks long lines at the character limit', () => {
    const lines = captionLines(words('one two three four five six seven eight nine ten eleven twelve'), { maxChars: 20, pauseS: 10 })
    expect(lines.every((l) => l.text.length <= 20)).toBe(true)
    expect(lines.map((l) => l.text).join(' ')).toBe('one two three four five six seven eight nine ten eleven twelve')
  })

  it('breaks at a long pause', () => {
    const lines = captionLines([...words('first part', 0), ...words('second part', 3)], { pauseS: 0.45 })
    expect(lines).toHaveLength(2)
  })

  it('writes valid SRT timestamps', () => {
    const srt = toSrt([{ text: 'Hi', start: 61.234, end: 62.5 }])
    expect(srt).toBe('1\n00:01:01,234 --> 00:01:02,500\nHi\n')
  })

  it('shifts words onto the joined timeline', () => {
    expect(shiftWords([{ word: 'a', start: 0.1, end: 0.2 }], 2.88)).toEqual([{ word: 'a', start: 2.98, end: 3.08 }])
  })
})

describe('voice helpers', () => {
  it('pauses longer after a full stop', () => {
    expect(pauseAfter('Done.')).toBe(0.4)
    expect(pauseAfter('Wait, what?')).toBe(0.4)
    expect(pauseAfter('and then')).toBe(0.25)
  })

  it('caches by voice, reference, text, direction and seed', () => {
    const base = lineKey('v', 'h', { text: 'Hi' }, 42)
    expect(lineKey('v', 'h', { text: ' Hi ' }, 42)).toBe(base)
    expect(lineKey('v', 'h', { text: 'Hi', direction: 'excited' }, 42)).not.toBe(base)
    expect(lineKey('v', 'h2', { text: 'Hi' }, 42)).not.toBe(base)
    expect(lineKey('v', 'h', { text: 'Hi' }, 7)).not.toBe(base)
  })
})

describe('caption balance', () => {
  it('never leaves a single orphan word when a sentence wraps', () => {
    const lines = captionLines(words("Today I'm going to show you how a local video model can lip-sync to your own voice."))
    expect(lines.length).toBe(3) // 82 characters can't fit two 42-character lines at word boundaries
    expect(lines.every((l) => l.text.split(' ').length > 1 && l.text.length <= 42)).toBe(true)
    const lengths = lines.map((l) => l.text.length)
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(12)
  })
})
