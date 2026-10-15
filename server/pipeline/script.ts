import type { ScriptLine } from './voice.ts'

/** One spoken line per text line; a trailing `[direction]` sets its delivery, e.g. `Hello! [excited]`. */
export function parseScript(text: string): ScriptLine[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(line)
      return match ? { text: match[1].trim(), direction: match[2].trim() } : { text: line }
    })
    .filter((line) => line.text.length > 0)
}

/** The inverse, for showing a saved script in an editor. */
export function scriptText(lines: ScriptLine[]): string {
  return lines.map((line) => (line.direction ? `${line.text} [${line.direction}]` : line.text)).join('\n')
}
