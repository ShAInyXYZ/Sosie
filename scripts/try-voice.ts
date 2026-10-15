// M3 check: import the user's voice ("Me"), design a narrator voice, voice a short script with it,
// join + normalise + align, write captions. Usage: npx tsx scripts/try-voice.ts
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, loadConfig } from '../server/config.ts'
import { captionLines, toSrt } from '../server/pipeline/captions.ts'
import { designVoice, importVoice, listVoices, speakScript } from '../server/pipeline/voice.ts'
import { readFileSync } from 'node:fs'

const config = loadConfig()
let voices = listVoices()
if (!voices.some((v) => v.name === 'Me') && config.paths.importVoiceSample) {
  // The configured sample is the user's own voice (config/sosie.local.json); consent is theirs.
  const me = await importVoice({ name: 'Me', sample: config.paths.importVoiceSample, transcript: readFileSync(config.paths.importVoiceTranscript, 'utf8'), consent: true })
  console.log('imported', me.name, me.id)
}
if (!voices.some((v) => v.name === 'Narrator')) {
  const started = Date.now()
  const narrator = await designVoice(config, { name: 'Narrator', description: 'A warm, confident man in his thirties with a clear, friendly voice and a relaxed, conversational delivery, like a tech streamer explaining something to his audience.' })
  console.log('designed', narrator.name, narrator.id, `${((Date.now() - started) / 1000).toFixed(0)} s`)
}
voices = listVoices()
const narrator = voices.find((v) => v.name === 'Narrator')!

const script = [
  { text: "Hey everyone, welcome back to the channel." },
  { text: "Today I'm going to show you how a local video model can lip-sync to your own voice.", direction: 'excited, a bit faster' },
  { text: 'And the best part? It all runs on your own machine.' },
]
const work = join(ROOT, 'data', 'spike', 'm3-voice')
const started = Date.now()
const track = await speakScript(config, narrator.id, script, work, { onProgress: (d, t) => console.log(`line ${d}/${t}`) })
writeFileSync(join(work, 'words.json'), JSON.stringify(track.words, null, 0))
writeFileSync(join(work, 'captions.srt'), toSrt(captionLines(track.words)))
console.log(JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), durationS: track.durationS, lines: track.lines.map((l) => ({ startS: l.startS, durationS: l.durationS })), words: track.words.length }))
