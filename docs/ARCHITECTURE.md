# Sosie architecture

How the code is laid out and how one video is made. Decisions and measured facts are in [PROGRESS.md](PROGRESS.md).

## Processes

| Process | Started by | Port | Notes |
|---|---|---|---|
| API (Express 5) | `scripts/start.sh api` (`node --import tsx server/index.ts`) | 3190 | serves the built Studio from `dist/`, the REST API ([API.md](API.md)) and the job queue |
| Sosie's ComfyUI | `scripts/start.sh comfy` | 8190 | pinned in `comfy/lock.json`, own venv, own `data/comfy-io/{input,output,temp}`, shared weights read through `comfy/extra_model_paths.yaml`; `--default-device` = the H3 compute card (`comfy/launch-args.ts`) |
| Python tools | the API, one process per call (`server/py.ts`) | — | `py/<tool>.py <request.json>`: `tts`, `dots`, `align`, `qc`, `cutout`; offline (`HF_HUB_OFFLINE`), GPU chosen per call; `dots` runs in its own environment (`py/dots-tts/.venv`) |
| Studio dev server | `npm run dev` | 5190 | Vite with `/api` proxied to 3190 |

The API accepts requests addressed to localhost only, and browser requests only from Sosie's own origins (`server/app.ts`).

## Code map

| Area | Files |
|---|---|
| Config | `server/config.ts` (zod; `config/sosie.example.json` documents every key, `config/sosie.local.json` holds this machine's) |
| API | `server/app.ts` routes · `server/jobs.ts` queue · `server/library.ts` trash · `server/moceanx.ts` Send to MOceanX · `server/script-ai.ts` Write with AI · `server/system.ts` lamps and GPUs |
| Job runner | `server/pipeline/job.ts`: steps, resume, re-roll, rescore, join, bundle; `Engines` (`realEngines` or `server/testing/fake-engines.ts`) |
| Voice | `server/pipeline/voice.ts` (import, design, line cache, trim, pace, join, loudness, alignment) · `server/pipeline/script.ts` (script lines and controls) · `py/tts.py` (Breeze TTS 2) · `py/dots.py` (Dots TTS, optional) · `py/align.py` (faster-whisper) · `server/pipeline/captions.ts` |
| Segments | `server/pipeline/plan.ts` (cuts at line pauses, then word gaps) · `server/pipeline/segments.ts` (24 fps, 17k+5 grid, ≤ 243 frames) |
| Video | `server/pipeline/h3.ts` (`talkGraph`, formats, speed LoRAs) · `server/pipeline/prompt.ts` · `comfy/workflows/talk_segment.json` · `server/comfy/*` (client, templates, device mapping) |
| Faces and looks | `server/pipeline/faces.ts` (library) · `server/pipeline/look.ts` (looks, Qwen Image 2.1 sets and characters, photo cut-out) · `comfy/workflows/character.json` · `py/cutout.py` (BiRefNet + framing checks) |
| QC | `py/qc.py` (frames, face, lip sync) · `py/syncnet.py` (SyncNet LSE-C/LSE-D/offset) · `server/pipeline/qc-report.ts` · `py/verify_bundle.py` (whole-video checks) |
| Media | `server/media/ffmpeg.ts` (reference audio, cuts, trim + mux) |
| Studio | `src/App.tsx` (cards, bottom bar, System) · `src/windows.tsx` (Face, Voice, Script, Look, Library, Settings) · `src/stage.tsx` (preview, progress, result) · `src/zoom.tsx` · `src/ui/*` (NeuronKit adapters from MOceanX) |

## One video

`POST /api/jobs` (or `npm run sosie -- make`) queues a job. Jobs run one at a time because they share the GPUs. Every step saves `data/projects/<id>/job.json`, so a crash, a cancel or a restart resumes where it stopped.

1. **Voice**: each script line is voiced by the chosen engine, Breeze TTS 2 (24 kHz) or Dots TTS (48 kHz), cached per engine, voice, text, note and seed; trimmed to its speech, stretched to its `pace`, joined with its `pause`, loudness-normalised once (−16 LUFS), and aligned word by word with faster-whisper (vocal events removed). See docs/VOICE_PROMPTING.md.
2. **Plan**: the track is cut into segments of 6–10 s, at line pauses first, word gaps otherwise.
3. **Face**: the face's key frame is copied into ComfyUI's input folder.
4. **Film**: for each segment, H3 Ref2VA renders a 17k+5 frame clip from the key frame, the prompt (subject, set, dialogue, delivery) and the segment's own voice as `<Audio 1>` (`fully_copy`) anchored at frame 0. The clip is cut to the segment's exact frame count and muxed with its voice; QC scores it. A failing take is filmed once more with a new seed; if both fail, the best is kept and flagged for a re-roll.
5. **Join**: the segment videos are concatenated (optional 8 % punch-in on every other one) under the untouched joined voice track. Lengths are cut with filters, never with an output frame limit (which drops the end of the audio).
6. **Bundle**: `facecam.mp4`, `captions.srt`, `words.json`, `project.json` (bundle v1, no local paths) and `poster.jpg`, plus the QC report beside the bundle.

## QC

Per segment (`py/qc.py`): exact frame count; no black, frozen or noise-spike frames; a face in ≥ 95 % of frames (no face at all = unscored, e.g. a stylised character); lip sync by SyncNet at 25 fps: offset −3…+1 frames, LSE-C ≥ 6, LSE-D ≤ 9. Thresholds and the measurements behind them: master prompt §3.4 and §6.7.

## GPUs

Physical indices from the config (`CUDA_DEVICE_ORDER=PCI_BUS_ID`). H3: DiT on `gpus.h3.dit` (ComfyUI's default device, where VEDA's kernels and the video VAE run) with weights spilled to `ditDonor`, the text encoder on `textEncoder`. Images and TTS pick the freest card from their lists. Before filming, the job frees ComfyUI's image models and checks free VRAM; it stops with a clear message if a card is short.

## Tests

- `tests/*.test.ts` (Vitest): config, segment math, prompt, templates, devices, planning, voice and captions, media trim/join, the HTTP job lifecycle with fake engines.
- `tests/studio.e2e.ts` (`npm run test:ui`): the Studio in Chromium against the real API with fake engines.
- `py/test_qc.py`: SyncNet verdicts on measured scores.
