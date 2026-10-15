// Lip-sync timing experiment on one segment of a finished job: same seed, three conditioning variants.
// Usage: npx tsx scripts/ab-sync.ts <job-id> <segment-number> [variant…]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComfyClient } from '../server/comfy/client.ts'
import { dropNode, type Graph } from '../server/comfy/template.ts'
import { ROOT, loadConfig } from '../server/config.ts'
import { trimAndMux } from '../server/media/ffmpeg.ts'
import { getFace } from '../server/pipeline/faces.ts'
import { talkGraph } from '../server/pipeline/h3.ts'
import { loadJob, projectDir } from '../server/pipeline/job.ts'
import { talkPrompt } from '../server/pipeline/prompt.ts'
import { FPS } from '../server/pipeline/segments.ts'
import { runPy } from '../server/py.ts'

const [jobId, segArg] = process.argv.slice(2)
const config = loadConfig()
const job = loadJob(jobId)!
const seg = job.segments[Number(segArg) - 1]
const face = getFace(job.spec.faceId)
const tag = `seg-${String(seg.index + 1).padStart(2, '0')}`
const inputRel = `sosie/${jobId}`
const segDir = join(projectDir(jobId), 'segments')
const out = join(ROOT, 'data', 'spike', `ab-${tag}`)
mkdirSync(out, { recursive: true })
const comfy = new ComfyClient(`http://127.0.0.1:${config.ports.comfy}`)
const seed = seg.attempts[0]?.seed ?? seg.seedBase

const base = (withDialogue: boolean) => talkGraph(config, {
  keyFrame: `${inputRel}/keyframe.png`, audio: `${inputRel}/${tag}.wav`,
  prompt: talkPrompt({ subject: face.subject, set: face.set, text: seg.text, direction: seg.direction, withDialogue }),
  format: job.spec.format, renderFrames: seg.renderFrames, seed, lora: job.spec.lora, outPrefix: `${inputRel}/ab-${tag}`,
})
const noAnchor = (graph: Graph): Graph => {
  const g = dropNode(graph, '10')
  g['14'].inputs.conditioning = ['9', 0]
  return g
}
const noVeda = (graph: Graph): Graph => {
  const g = dropNode(graph, '6')
  g['14'].inputs.model = ['5', 0]
  return g
}
const withLora = (lora: typeof job.spec.lora) => talkGraph(config, {
  keyFrame: `${inputRel}/keyframe.png`, audio: `${inputRel}/${tag}.wav`,
  prompt: talkPrompt({ subject: face.subject, set: face.set, text: seg.text, direction: seg.direction, withDialogue: true }),
  format: job.spec.format, renderFrames: seg.renderFrames, seed, lora, outPrefix: `${inputRel}/ab-${tag}`,
})
const all: Record<string, () => Graph> = {
  'A-as-is': () => base(true),
  'B-no-anchor': () => noAnchor(base(true)),
  'D-no-dialogue': () => base(false),
  'E-no-veda': () => noVeda(base(true)),
  'F-turbo4': () => withLora('turbo4'),
  'G-turbo4-no-veda': () => noVeda(withLora('turbo4')),
}
const picked = process.argv.slice(4)
const variants: [string, Graph][] = (picked.length ? picked : ['A-as-is', 'B-no-anchor', 'D-no-dialogue']).map((name) => [name, all[name]()])
writeFileSync(join(out, 'words.json'), JSON.stringify(seg.words))
const results: Record<string, unknown>[] = []
for (const [name, graph] of variants) {
  const started = Date.now()
  const result = await comfy.run(graph)
  const raw = result.files.find((f) => f.filename.endsWith('.mp4'))!
  const file = join(out, `${name}.mp4`)
  await trimAndMux(join(ROOT, 'data', 'comfy-io', 'output', raw.subfolder, raw.filename), join(segDir, `${tag}-voice.wav`), seg.frames, FPS, file)
  const qcFile = join(out, `${name}-qc.json`)
  await runPy('qc', { video: file, audio: join(segDir, `${tag}-voice.wav`), frames: seg.frames, landmarker: join(ROOT, 'py', 'models', 'face_landmarker.task'), out: qcFile, words: seg.words }, { gpu: null, workDir: out })
  const qc = JSON.parse(readFileSync(qcFile, 'utf8'))
  results.push({ name, seconds: Math.round((Date.now() - started) / 1000), pass: qc.pass, lipSync: qc.lipSync })
  console.log(JSON.stringify(results.at(-1)))
}
await comfy.free()
writeFileSync(join(out, 'report.json'), JSON.stringify(results, null, 1))
