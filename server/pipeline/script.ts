import type { ScriptLine } from './voice.ts'

/** Vocal events Breeze performs when written in the text (docs/VOICE_PROMPTING.md). */
export const VOCAL_EVENTS = ['laugh', 'sigh', 'cough', 'clears throat'] as const
const EVENT = /\(\s*(laugh|laughs|sigh|sighs|cough|coughs|clears throat)\s*\)/gi

/** Pace and pause limits: a gentle time-stretch, and up to 3 s of silence after a line. */
export const PACE = { min: 0.7, max: 1.3 } as const
export const PAUSE = { min: 0, max: 3 } as const

const clamp = (value: number, range: { min: number; max: number }) => Math.min(range.max, Math.max(range.min, value))
const round = (value: number) => Math.round(value * 100) / 100

/** The words actually spoken: vocal events removed (for Dots, captions, alignment and the video prompt). */
export function spokenText(text: string): string {
  return text.replace(EVENT, ' ').replace(/\s+/g, ' ').replace(/\s+([,.!?…;:])/g, '$1').trim()
}

/**
 * One spoken line per text line. A trailing `[…]` holds its delivery note and controls, separated by `;`:
 * `Hello! [excited, playful; pace 0.9; pause 1.2]`. pace 1 = natural speed (0.9 = 10 % slower);
 * pause = seconds of silence after the line. Everything else in the brackets is the delivery note.
 */
export function parseScript(text: string): ScriptLine[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((raw) => {
      const match = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(raw)
      if (!match) return { text: raw }
      const line: ScriptLine = { text: match[1].trim() }
      const notes: string[] = []
      for (const part of match[2].split(';').map((p) => p.trim()).filter(Boolean)) {
        const control = /^(pace|pause)\s*[=:]?\s*(\d+(?:\.\d+)?)\s*s?$/i.exec(part)
        if (control?.[1].toLowerCase() === 'pace') line.pace = round(clamp(Number(control[2]), PACE))
        else if (control) line.pause = round(clamp(Number(control[2]), PAUSE))
        else notes.push(part)
      }
      if (notes.length) line.direction = notes.join('; ')
      return line
    })
    .filter((line) => line.text.length > 0)
}

/** The inverse, for showing a saved script in an editor. */
export function scriptText(lines: ScriptLine[]): string {
  return lines.map((line) => {
    const parts = [line.direction?.trim() ?? '']
    if (line.pace !== undefined && line.pace !== 1) parts.push(`pace ${line.pace}`)
    if (line.pause !== undefined) parts.push(`pause ${line.pause}`)
    const bracket = parts.filter(Boolean).join('; ')
    return bracket ? `${line.text} [${bracket}]` : line.text
  }).join('\n')
}
