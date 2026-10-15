// Quality A/B on one segment of a finished job: same seed, same voice, one change at a time.
// Usage: npx tsx scripts/ab-quality.ts <job-id> <segment-number> [variant…]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComfyClient } from '../server/comfy/client.ts'
import { ROOT, loadConfig } from '../server/config.ts'
import { trimAndMux } from '../server/media/ffmpeg.ts'
import { getFace } from '../server/pipeline/faces.ts'
import { talkGraph } from '../server/pipeline/h3.ts'
import { loadJob, projectDir } from '../server/pipeline/job.ts'
import { talkPrompt } from '../server/pipeline/prompt.ts'
import { FPS } from '../server/pipeline/segments.ts'
import { runPy } from '../server/py.ts'
import { syncnetWeights } from '../server/pipeline/job.ts'

const [jobId, segArg, ...picked] = process.argv.slice(2)
const config = loadConfig()
const job = loadJob(jobId)!
const seg = job.segments[Number(segArg) - 1]
const face = getFace(job.spec.faceId)
const tag = `seg-${String(seg.index + 1).padStart(2, '0')}`
const inputRel = `sosie/${jobId}`
const segDir = join(projectDir(jobId), 'segments')
const out = join(ROOT, 'data', 'spike', `quality-${jobId.slice(0, 8)}`)
mkdirSync(out, { recursive: true })
const comfy = new ComfyClient(`http://127.0.0.1:${config.ports.comfy}`)
const seed = seg.attempts[0]?.seed ?? seg.seedBase
const VAE = { int8: 'minimax_h3_video_vae_int8_convrot.safetensors', fp16: 'minimax_h3_video_vae_fp16.safetensors' }

// every setting is explicit, so the names keep their meaning when the defaults change
type Variant = { size: number; vae: keyof typeof VAE; ref: 'match' | 'max' }
const all: Record<string, Variant> = {
  'A-640': { size: 640, vae: 'int8', ref: 'match' },
  'B-768': { size: 768, vae: 'int8', ref: 'match' },
  'C-768-fp16vae': { size: 768, vae: 'fp16', ref: 'match' },
  'D-768-fp16vae-refmax': { size: 768, vae: 'fp16', ref: 'max' },
  'E-1088-fp16vae-refmax': { size: 1088, vae: 'fp16', ref: 'max' },
  'F-1024-fp16vae-refmax': { size: 1024, vae: 'fp16', ref: 'max' },
}
const names = picked.length ? picked : Object.keys(all)
// earlier versions stay in the report; a re-run of the same name replaces its entry
const reportFile = join(out, 'report.json')
const results: Record<string, unknown>[] = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : []
for (const name of names) {
  const v = all[name]
  const graph = talkGraph(config, {
    keyFrame: `${inputRel}/keyframe.png`, audio: `${inputRel}/${tag}.wav`,
    prompt: talkPrompt({ subject: face.subject, set: face.set, text: seg.text, direction: seg.direction }),
    format: job.spec.format, renderFrames: seg.renderFrames, seed, lora: job.spec.lora, outPrefix: `${inputRel}/q-${name}`,
    size: { width: v.size, height: v.size }, refImageSize: v.ref,
  })
  graph['3'].inputs.vae_name = VAE[v.vae]
  const started = Date.now()
  const result = await comfy.run(graph)
  const seconds = Math.round((Date.now() - started) / 1000)
  const raw = result.files.find((f) => f.filename.endsWith('.mp4'))!
  const file = join(out, `${name}.mp4`)
  await trimAndMux(join(ROOT, 'data', 'comfy-io', 'output', raw.subfolder, raw.filename), join(segDir, `${tag}-voice.wav`), seg.frames, FPS, file)
  const qcFile = join(out, `${name}-qc.json`)
  await runPy('qc', { video: file, audio: join(segDir, `${tag}-voice.wav`), frames: seg.frames, landmarker: join(ROOT, 'py', 'models', 'face_landmarker.task'), syncnet: syncnetWeights(config), out: qcFile }, { gpu: null, workDir: out })
  const qc = JSON.parse(readFileSync(qcFile, 'utf8'))
  const entry = { name, seconds, pass: qc.pass, lipSync: qc.lipSync }
  const at = results.findIndex((r) => r.name === name)
  if (at >= 0) results[at] = entry
  else results.push(entry)
  console.log(JSON.stringify(entry))
  writeFileSync(reportFile, JSON.stringify(results, null, 1))
}
await comfy.free()
