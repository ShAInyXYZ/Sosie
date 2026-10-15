// Lip-sync probe: re-film one segment of a finished job (same seed) and also decode the audio H3
// generates alongside the picture, to compare its timing with the voice we feed in.
// Usage: npx tsx scripts/av-probe.ts <job-id> <segment-number>
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComfyClient } from '../server/comfy/client.ts'
import { ROOT, loadConfig } from '../server/config.ts'
import { trimAndMux } from '../server/media/ffmpeg.ts'
import { getFace } from '../server/pipeline/faces.ts'
import { talkGraph } from '../server/pipeline/h3.ts'
import { loadJob, projectDir } from '../server/pipeline/job.ts'
import { talkPrompt } from '../server/pipeline/prompt.ts'
import { FPS } from '../server/pipeline/segments.ts'

const [jobId, segArg] = process.argv.slice(2)
const config = loadConfig()
const job = loadJob(jobId)!
const seg = job.segments[Number(segArg) - 1]
const face = getFace(job.spec.faceId)
const tag = `seg-${String(seg.index + 1).padStart(2, '0')}`
const inputRel = `sosie/${jobId}`
const segDir = join(projectDir(jobId), 'segments')
const out = join(ROOT, 'data', 'spike', `av-${tag}`)
mkdirSync(out, { recursive: true })
const comfy = new ComfyClient(`http://127.0.0.1:${config.ports.comfy}`)
const seed = seg.attempts[0]?.seed ?? seg.seedBase

const graph = talkGraph(config, {
  keyFrame: `${inputRel}/keyframe.png`, audio: `${inputRel}/${tag}.wav`,
  prompt: talkPrompt({ subject: face.subject, set: face.set, text: seg.text, direction: seg.direction, withDialogue: true }),
  format: job.spec.format, renderFrames: seg.renderFrames, seed, lora: job.spec.lora, outPrefix: `${inputRel}/av-${tag}`,
})
graph['19'] = { class_type: 'LTXVAudioVAEDecode', inputs: { samples: ['16', 1], audio_vae: ['4', 0] } }
graph['20'] = { class_type: 'SaveAudio', inputs: { audio: ['19', 0], filename_prefix: `${inputRel}/av-${tag}-audio` } }
const result = await comfy.run(graph)
const io = join(ROOT, 'data', 'comfy-io', 'output')
const video = result.files.find((f) => f.filename.endsWith('.mp4'))!
const audio = result.files.find((f) => /\.(flac|wav|mp3|opus)$/.test(f.filename))!
copyFileSync(join(io, audio.subfolder, audio.filename), join(out, `generated-audio${audio.filename.slice(audio.filename.lastIndexOf('.'))}`))
await trimAndMux(join(io, video.subfolder, video.filename), join(segDir, `${tag}-voice.wav`), seg.frames, FPS, join(out, 'video.mp4'))
copyFileSync(join(segDir, `${tag}-voice.wav`), join(out, 'voice.wav'))
writeFileSync(join(out, 'info.json'), JSON.stringify({ jobId, segment: seg.index + 1, seed, frames: seg.frames, renderFrames: seg.renderFrames, audioFile: audio.filename }, null, 1))
await comfy.free()
console.log(`probe → ${out}`)
