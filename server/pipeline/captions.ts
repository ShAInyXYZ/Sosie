export type Word = { word: string; start: number; end: number }

function stamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`
}

/**
 * Group words into caption lines: break after sentence punctuation, after a pause longer than
 * `pauseS`, or when a line would exceed `maxChars`. Times come straight from the words.
 */
export function captionLines(words: Word[], { maxChars = 42, pauseS = 0.45 } = {}): { text: string; start: number; end: number }[] {
  // 1. phrases end at sentence punctuation or a pause
  const phrases: Word[][] = []
  let phrase: Word[] = []
  words.forEach((word, index) => {
    phrase.push(word)
    const next = words[index + 1]
    const sentenceEnd = /[.!?…]["')\]]*$/.test(word.word)
    const pause = next ? next.start - word.end > pauseS : true
    if (sentenceEnd || pause) {
      phrases.push(phrase)
      phrase = []
    }
  })
  if (phrase.length) phrases.push(phrase)

  // 2. a long phrase is split into the fewest lines that fit, with balanced lengths (no orphan last word)
  const lines: { text: string; start: number; end: number }[] = []
  const push = (group: Word[]) => lines.push({ text: group.map((w) => w.word).join(' '), start: group[0].start, end: group[group.length - 1].end })
  for (const group of phrases) {
    const length = group.map((w) => w.word).join(' ').length
    if (length <= maxChars) {
      push(group)
      continue
    }
    // fewest lines a greedy fill needs (word boundaries included), then aim for equal lengths
    let count = 1
    let fill = 0
    for (const word of group) {
      const added = fill ? fill + 1 + word.word.length : word.word.length
      if (fill && added > maxChars) {
        count += 1
        fill = word.word.length
      } else fill = added
    }
    const target = length / count
    // split into exactly `count` lines with lengths as even as possible (least squares, dynamic programming)
    const n = group.length
    const span = (i: number, j: number) => group.slice(i, j).map((w) => w.word).join(' ').length
    const best: number[][] = Array.from({ length: count + 1 }, () => Array(n + 1).fill(Infinity))
    const from: number[][] = Array.from({ length: count + 1 }, () => Array(n + 1).fill(-1))
    best[0][0] = 0
    for (let k = 1; k <= count; k++) {
      for (let j = 1; j <= n; j++) {
        for (let i = k - 1; i < j; i++) {
          if (best[k - 1][i] === Infinity) continue
          const len = span(i, j)
          if (len > maxChars && j - i > 1) continue
          const cost = best[k - 1][i] + (target - len) ** 2
          if (cost < best[k][j]) {
            best[k][j] = cost
            from[k][j] = i
          }
        }
      }
    }
    const cuts: number[] = []
    for (let k = count, j = n; k > 0; k--) {
      cuts.unshift(j)
      j = from[k][j]
    }
    let previous = 0
    for (const cut of cuts) {
      push(group.slice(previous, cut))
      previous = cut
    }
  }
  return lines
}

export function toSrt(lines: { text: string; start: number; end: number }[]): string {
  return lines.map((line, index) => `${index + 1}\n${stamp(line.start)} --> ${stamp(Math.max(line.end, line.start + 0.2))}\n${line.text}\n`).join('\n')
}

/** Shift every word by `offset` seconds (lines are aligned one by one, then placed on the joined track). */
export function shiftWords(words: Word[], offset: number): Word[] {
  return words.map((w) => ({ word: w.word, start: +(w.start + offset).toFixed(3), end: +(w.end + offset).toFixed(3) }))
}
