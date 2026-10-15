// Sosie from the terminal (the same pipeline the app uses).
//   npm run sosie -- voices
//   npm run sosie -- faces
//   npm run sosie -- face add <key-frame.png> --name "Alex" --subject "…" --set "…" [--photo --consent]
//   npm run sosie -- make <script.txt> --face <id> --voice <id> [--name "…"] [--format corner|reel|wide] [--lora taomate|turbo4] [--seed 42] [--punch-in] [--first]
//   npm run sosie -- resume <job-id>
//   npm run sosie -- reroll <job-id> <segment-number>
//   npm run sosie -- rescore <job-id>     (QC every take again, keep the best, join and bundle again)
// Script file: one line per spoken line; an optional delivery note in brackets at the end: "Hello! [excited]".
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { loadConfig } from './config.ts'
import { listFaces, saveFace } from './pipeline/faces.ts'
import { FORMATS, SPEED_LORAS, type Format, type SpeedLora } from './pipeline/h3.ts'
import { loadJob, realEngines, rerollSegment, rescoreJob, runJob, type JobSpec, type JobState } from './pipeline/job.ts'
import { parseScript } from './pipeline/script.ts'
import { listVoices } from './pipeline/voice.ts'

const [command, ...rest] = process.argv.slice(2)

function flag(name: string): string | undefined {
  const index = rest.indexOf(`--${name}`)
  return index >= 0 ? rest[index + 1] : undefined
}
const has = (name: string) => rest.includes(`--${name}`)

function report(state: JobState) {
  const pct = Math.round(state.progress * 100)
  process.stdout.write(`\r${String(pct).padStart(3)}%  ${state.message}`.padEnd(90))
}

async function main() {
  const config = loadConfig()
  switch (command) {
    case 'voices':
      for (const v of listVoices()) console.log(`${v.id}  ${v.name}  (${v.kind})`)
      return
    case 'faces':
      for (const f of listFaces()) console.log(`${f.id}  ${f.name}  (${f.kind})  ${f.subject}`)
      return
    case 'face': {
      if (rest[0] !== 'add' || !rest[1]) throw new Error('usage: face add <key-frame.png> --name … --subject … --set … [--photo --consent]')
      const face = saveFace({ keyFrame: rest[1], name: flag('name') ?? 'Face', kind: has('photo') ? 'photo' : 'character', subject: flag('subject') ?? '', set: flag('set') ?? '', consent: has('consent') || !has('photo') })
      console.log(face.id)
      return
    }
    case 'make': {
      const file = rest[0]
      const faceId = flag('face')
      const voiceId = flag('voice')
      if (!file || !faceId || !voiceId) throw new Error('usage: make <script.txt> --face <id> --voice <id>')
      const format = (flag('format') ?? 'corner') as Format
      const lora = (flag('lora') ?? 'taomate') as SpeedLora
      if (!(format in FORMATS)) throw new Error(`format must be one of ${Object.keys(FORMATS).join(', ')}`)
      if (!(lora in SPEED_LORAS)) throw new Error(`lora must be one of ${Object.keys(SPEED_LORAS).join(', ')}`)
      const spec: JobSpec = {
        id: randomUUID(), name: flag('name') ?? file.replace(/^.*\//, '').replace(/\.[^.]+$/, ''),
        script: parseScript(readFileSync(file, 'utf8')), voiceId, faceId, format, lora,
        seed: Number(flag('seed') ?? 42), punchIn: has('punch-in'), firstSegmentOnly: has('first'),
      }
      console.log(`job ${spec.id}: ${spec.script.length} lines`)
      const state = await runJob(config, spec, { onUpdate: report })
      finish(state)
      return
    }
    case 'resume': {
      const state = loadJob(rest[0])
      if (!state) throw new Error('job not found')
      finish(await runJob(config, state.spec, { onUpdate: report }))
      return
    }
    case 'rescore': {
      const state = await rescoreJob(rest[0], realEngines(config))
      for (const s of state.segments) {
        const best = s.attempts.find((a) => a.file === s.file)
        console.log(`  segment ${s.index + 1}: ${s.status} — ${JSON.stringify(best?.qc.lipSync)}`)
      }
      finish(await runJob(config, state.spec, { onUpdate: report }))
      return
    }
    case 'reroll': {
      const state = rerollSegment(rest[0], Number(rest[1]) - 1)
      finish(await runJob(config, state.spec, { onUpdate: report }))
      return
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
  }
}

function finish(state: JobState) {
  process.stdout.write('\n')
  if (state.status !== 'done') {
    console.error(`${state.status}: ${state.error ?? state.message}`)
    process.exitCode = 1
    return
  }
  console.log(`done → ${state.outputs!.video}`)
  for (const s of state.segments) console.log(`  segment ${s.index + 1}: ${s.status} (${s.attempts.length} take${s.attempts.length > 1 ? 's' : ''}, ${(s.durationS).toFixed(1)} s)`)
  console.log(`  timings: ${JSON.stringify(state.timings)}`)
}

const isMain = process.argv[1]?.endsWith('cli.ts')
if (isMain) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
