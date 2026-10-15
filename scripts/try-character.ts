// M5 real run: four character options (Qwen Image 2.1, optional speed LoRA) → a 2×2 sheet.
// Usage: npx tsx scripts/try-character.ts [lora-file|none] [strength]
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT, loadConfig } from '../server/config.ts'
import { characterCandidates, imageSteps } from '../server/pipeline/look.ts'

const config = loadConfig()
const [loraArg = 'none', strength = '1'] = process.argv.slice(2)
const lora = loraArg === 'none' ? null : { file: loraArg, strength: Number(strength) }
const started = Date.now()
const files = await characterCandidates(config, { who: 'a friendly woman in her late twenties', hair: 'shoulder-length auburn hair', outfit: 'a cream knit sweater', style: 'photo' }, 'studio-desk', 'corner', 4, ROOT, lora)
const seconds = Math.round((Date.now() - started) / 1000)
const sheet = join(ROOT, 'data', 'spike', `m5-options-${loraArg === 'none' ? 'base' : 'lora'}.jpg`)
execFileSync('ffmpeg', ['-v', 'error', '-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `${files.map((_, i) => `[${i}:v]scale=512:512[s${i}]`).join(';')};[s0][s1][s2][s3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0`, '-q:v', '3', sheet])
console.log(JSON.stringify({ lora: loraArg, steps: imageSteps(lora), seconds, perImage: Math.round(seconds / 4), files, sheet }))
