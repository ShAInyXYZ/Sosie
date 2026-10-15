# Sosie HTTP API

Base URL `http://127.0.0.1:3190`. JSON in and out unless noted. Requests must be addressed to localhost; browser requests are accepted only from Sosie's own origins. Errors are `{ "error": "<what happened and what to do>" }` with a 4xx/5xx status.

## System

| Method | Route | Body → result |
|---|---|---|
| GET | `/api/health` | `{ ok, app: "sosie", version }` |
| GET | `/api/system` | `{ services: { api, comfy, python }, gpus, problems, dots }` (lamps: `ok`, `down`, `missing`; `dots` is null when the Dots voice engine can run, else why not) |
| POST | `/api/system/start` | starts Sosie's ComfyUI in the background → `202 { starting: true }` |
| POST | `/api/system/free-main` | asks the main ComfyUI (`mainComfyUrl`) to unload its models → `{ freed: true }` |

## Library

| Method | Route | Body → result |
|---|---|---|
| GET | `/api/faces` | `{ faces: Face[] }` |
| GET | `/api/faces/:id/keyframe` | the face's key frame (PNG) |
| POST | `/api/faces/photo` | multipart `photo`, `name`, `look`, `format`, `consent=true`, `subject?` → `201 Face & { warnings }` (cut-out over a generated set; no face → 400) |
| GET | `/api/image-loras` | `{ loras: [{ file, steps }], default }` (Qwen Image 2.1 LoRAs from the config) |
| POST | `/api/faces/characters` | `{ form: { who, age?, hair?, outfit?, style? }, look, format, lora?: { file, strength } \| null }` → `{ candidates: ["<batch>/1.png", …] }` (four options) |
| GET | `/api/candidates/:batch/:n.png` | a candidate image |
| POST | `/api/faces/characters/choose` | `{ candidate: "<batch>/<n>.png", name }` → `201 Face` |
| GET | `/api/voices` | `{ voices: Voice[] }` |
| POST | `/api/voices/import` | multipart `sample`, `name`, `transcript`, `consent=true` → `201 Voice` |
| POST | `/api/voices/design` | `{ name, description }` → `201 Voice` |
| GET | `/api/looks` | `{ looks: [{ id, name, prompt }] }` |
| DELETE | `/api/library/:kind/:id` | `kind` = `faces`, `voices` or `videos`; moves the item to `data/trash/` → `{ ok: true }` |

## Script

| Method | Route | Body → result |
|---|---|---|
| GET | `/api/script/providers` | `{ providers: [{ id: "claude" \| "codex", available }] }` |
| POST | `/api/script/write` | `{ context, brief, engine?: "breeze" \| "dots" }` → `{ script }` (one breath per line, `[note; pace …; pause …]`, written to that engine's guide in docs/VOICE_PROMPTING.md); 502 with a clear message when no CLI is installed or signed in |

## Videos (jobs)

| Method | Route | Body → result |
|---|---|---|
| GET | `/api/jobs` | `{ jobs: Job[] }`, newest first |
| POST | `/api/jobs` | `{ script, faceId, voiceId, format?, name?, lora?: "taomate" \| "turbo4", seed?, punchIn?, firstSegmentOnly?, steps?, size?: { width, height }, refImageSize?: "match" \| "max", voiceEngine?: "breeze" \| "dots" }` → `201 Job` (queued); `script` lines take `[note; pace 0.9; pause 1.2]` (docs/VOICE_PROMPTING.md); `voiceEngine: "dots"` is refused with the reason when Dots is not set up |
| GET | `/api/jobs/:id` | `Job`: `status` (`queued`, `running`, `done`, `failed`, `canceled`), `step`, `progress` 0–1, `message`, `segments` (each with `status` and its takes' QC) |
| DELETE | `/api/jobs/:id` | cancel |
| POST | `/api/jobs/:id/resume` | continue a canceled, failed or interrupted job |
| POST | `/api/jobs/:id/reroll` | `{ segment: <1-based> }` → film that segment again, then join and bundle again |
| POST | `/api/jobs/:id/send` | Send to MOceanX → `{ sent: true, folderPath }` or `{ sent: false, reason, bundle }` |
| GET | `/api/jobs/:id/files/:name` | `facecam.mp4`, `captions.srt`, `words.json`, `project.json`, `poster.jpg`, `qc.html` |

`script` is plain text: one spoken line per line, an optional `[direction]` at the end of a line.
