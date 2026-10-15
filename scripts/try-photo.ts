// M5 real run: a photo → BiRefNet cut-out (pixels kept) over a generated set → key frame; before/after sheet.
// Usage: npx tsx scripts/try-photo.ts <photo.png|jpg> [look-id]
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT, loadConfig } from '../server/config.ts'
import { trashItem } from '../server/library.ts'
import { faceFiles } from '../server/pipeline/faces.ts'
import { photoFace, type LookId } from '../server/pipeline/look.ts'

const config = loadConfig()
const [photo, look = 'home-office'] = process.argv.slice(2)
const started = Date.now()
const face = await photoFace(config, { photo, name: 'Photo test', lookId: look as LookId, format: 'corner', consent: true }, ROOT)
const seconds = Math.round((Date.now() - started) / 1000)
const sheet = join(ROOT, 'data', 'spike', 'm5-photo-cutout.jpg')
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', photo, '-i', faceFiles(face.id).keyFrame, '-filter_complex', '[0:v]scale=-2:640[a];[1:v]scale=-2:640[b];[a][b]hstack=inputs=2', '-q:v', '3', sheet])
trashItem('faces', face.id) // a test, not a library item
console.log(JSON.stringify({ seconds, warnings: face.warnings, sheet }))
