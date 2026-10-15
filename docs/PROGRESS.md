# Sosie — Progress

Living checklist for [MASTER_PROMPT.md](MASTER_PROMPT.md). Each ticked item names its evidence (test, file, commit) and date.

## Milestones

- [x] Master prompt written and reviewed (v1 → independent critique → v2) — 2026-10-15
- [x] M0 Scaffold — 2026-10-15 · build passes, `npm test` 7/7 (config loader, GPU parsing), API `/api/health` + `/api/system` live on 3190, shell screenshots `docs/media/m0-studio-shell-{dark,light}.png`
- [x] M1 Own ComfyUI (+ VEDA R2VA predictor download) — 2026-10-15 · `comfy/setup.sh` built ComfyUI 0.37.1 (3f767e7f) + MultiGPU/VEDA/VHS/KJNodes at the container's pins in 7 m 46 s (`data/run/comfy-setup.log`); running on 8190 with its own I/O dirs and 67 store folders via `extra_model_paths.yaml`; `/object_info` has MiniMaxH3ReferenceToVideo, MiniMaxH3AddGuide, VedaSparseAttention (both predictors), DisTorch2 loaders, TextEncodeQwenImage21; VEDA R2VA predictor archived to NAS (275 415 752 B, logged) and synced to the store (size verified); main container StartedAt unchanged (2026-10-14T11:56:10Z before and after)
- [x] M2 Lip-sync spike (speed-LoRA A/B, VEDA on) — 2026-10-15 · designed-voice line (8.56 s) + Qwen 2.1 key frame (`docs/media/m2-keyframe.png`, 66 s on GPU 3) → H3 Ref2VA with `<Audio 1>` fully_copy + AddGuide audio anchor; **TaoMate 3-step wins**: 205 s incl. load, QC pass (envelope margin 0.61, pause ratio 1.40, face 100%, no black/frozen/noise frames), framing locked; turbo-4: 254 s, margin 0.54, framing drifted. Media: `docs/media/m2-{taomate,turbo4}.mp4`, `-contact.jpg`, `-qc.json`. Found and fixed: VEDA + int8 VAE need ComfyUI's default device (`--default-device`, VAE on the compute card)
- [x] M3 Voice — 2026-10-15 · `server/pipeline/voice.ts` + `captions.ts`; `scripts/try-voice.ts`: imported **Me** (consented, from the configured sample), designed **Narrator** (6–10 s sample, then cloned), voiced a 3-line script with a direction note → 10.62 s joined track at −16.3 LUFS (two-pass loudnorm), 35 words aligned per line and shifted onto the track, balanced `captions.srt` (least-squares line split, no orphans); line cache keyed by voice/ref/text/direction/seed; 25 s end to end on GPU 1
- [x] M4 Pipeline (CLI first, 60 s proof) — 2026-10-15 · `npm run sosie -- make docs/media/proof-script.txt --face <Alex> --voice <Narrator>` (designed voice, created photo-real character): 11 lines → 63.9 s voice → 8 segments, 13 takes, 36 min of filming; resume, cancel and re-roll covered by `tests/api.test.ts` (fake engines). **All 8 segments pass QC** (SyncNet: offset 0/−1 frame, LSE-C 8.7–10.0). Whole video (`py/verify_bundle.py`): offset −1, LSE-C 8.9; audio = the TTS track (lag 0 ms at start and end); captions re-heard by Whisper match `words.json` at 0 ms from first to last word. Bundle v1 written. Media: `docs/media/m4-proof-60s.mp4` (64 s: the 60 s script ran 6 % long), `m4-proof-contact.jpg`, `m4-proof-qc.html` + `.json`, `m4-proof-verify.json`
- [x] M5 Face and look — 2026-10-15 · character creator: 4 options from Qwen Image 2.1 with the LoRA picker (default `Qwen-Image-2.1-viggle-turbo-v0.2-5step-lora-r256`, 5 steps): 68 s for 4 photo-real, frontal, chest-up options (`docs/media/m5-character-options.jpg`); photo import: framing checks (one face, size, centre, yaw → warnings; no face stops it), BiRefNet cut-out over a generated *Home office* set in 23 s, the person's pixels kept (`docs/media/m5-photo-cutout.jpg`, before/after); set presets (6 looks); library storage in `data/faces/` with trash-based delete
- [x] M6 Studio UI — 2026-10-15 · §7: four cards with hover cards → centred floating windows with Advanced (Face: faces, new character, LoRA picker + strength, photo with consent; Voice: list, design, import with consent; Script: editor + Write with AI; Look), bottom bar (format, Settings, ETA, Try first segment, Generate with a one-line reason), progress with the segment strip and Cancel, result with player, per-segment re-roll and QC lamps, Download MP4, Captions, Send to MOceanX; Library (search, delete with confirmation); System (lamps, Start services, Advanced VRAM bars, Free main ComfyUI VRAM); Settings (speed LoRA, punch-in; Advanced: seed, steps, size override, reference size); zoom/pan viewers, no selectable chrome, no image drag · `npm run test:ui` (Playwright, real API, fake engines): gating, windows, Try first segment, progress, result, one-click Generate, keyboard, both themes · `docs/media/m6-{empty,result}-{dark,light}.png`
- [x] M7 Script AI — 2026-10-15 · Context + brief → **Write** (Script window, Advanced) through the local Claude Code or Codex CLI (`server/script-ai.ts`, read-only, no tools, JSON schema); real run with Claude Code: 6 lines with delivery notes in 14 s; notes flow to TTS and the H3 prompt as `[direction]`; without a CLI: "No Claude Code or Codex CLI was found on this machine. Install one and sign in, or type the script yourself." (`tests/pipeline.test.ts`)
- [ ] M6 Studio UI
- [ ] M7 Script AI
- [x] M8 Docs and proof — 2026-10-15 · `README.md` (setup, start, use, CLI, bundle, tests, licences stated plainly incl. MiniMax's excluded territories), `docs/ARCHITECTURE.md`, `docs/API.md` (every route); proof video, contact sheet and QC report from M4; **Send to MOceanX** checked live: Sosie's API → MOceanX `POST /api/sosie/import` → `MOceanX/projects/sosie-proof.motion` (video + 31 word-timed cues, scene extended to 63.9 s)
- [x] W FastH3-Omni cron + ntfy — 2026-10-15 · `scripts/watch-fasth3-omni.sh` in the user's crontab (daily 09:00, active from 2026-10-20): asks Hugging Face (`author=FastVideo&search=Omni`, `search=FastH3-Omni`, `search=H3-Omni`), matches only a real FastH3-Omni id (checked against today's FastH3 checkpoints, FastVideo's LTX OmniNFT LoRAs and third-party "H3 … Omni" tools: none match), sends one ntfy push (`ntfyUrl` in the local config) and records it in `data/run/fasth3-omni.seen`; `WATCH_DRY_RUN=1` searches without notifying. A first dry run (before that mode existed) sent one false alert; a correction push followed

## Definition of done

Mirrors §1 of the master prompt; tick with evidence.

- [x] **One-click flow** — 2026-10-15 · Playwright with fake engines (`npm run test:ui`) + one real run from the Studio: Face (an uploaded photo) and Script only, Voice and Look at their defaults (Me, Home office), **Generate** → 8.2 s video, 1 segment passing QC (SyncNet offset 0, LSE-C 8.8), filming 202 s; `py/verify_bundle.py` passes (audio exact at both ends, caption drift 20 ms < 1 frame) · `docs/media/dod-oneclick-photo-contact.jpg`. The first attempt stopped on a VRAM check right after a Qwen image run (ComfyUI unloads asynchronously); the check now waits up to 30 s for the memory, and the job was continued
- [x] **Lip-synced long video** — 2026-10-15 · M4 proof: 8/8 segments pass, audio = the TTS track, caption drift 0 ms (`docs/media/m4-proof-*`)
- [x] **Two face sources** — 2026-10-15 · photo (cut out with its pixels kept, set generated; the one-click run above) and a character created in Sosie (the M4 proof's "Alex")
- [x] **Output bundle v1 for every video** — written by the job runner; both videos above have one
- [x] **Isolation** — 2026-10-15 · Sosie's own ComfyUI on 8190 and its own Python tools; main container `comfyui` StartedAt 2026-10-14T11:56:10Z (unchanged since M1), no Sosie files in its data folder, the Breeze model folder in Cerveau Hub unmodified (read only)
- [x] **Proof** — `docs/media/m4-proof-60s.mp4` (64 s), contact sheet, QC report; designed voice + created photo-real character; subjective quality under *Awaiting user review*
- [x] **Tests and docs** — 2026-10-15 · build, `npm test` (6 files, 38 tests), `npm run test:ui`, `py/test_qc.py` pass; README, ARCHITECTURE, API docs current
- [x] **Pushed** — every milestone committed and pushed with `nash push`

## Checks run

| Date | Check | Result |
|---|---|---|
| 2026-10-15 | `npm run build` | pass (main chunk 312 kB) |
| 2026-10-15 | `npm test` | 1 file, 7 tests pass |
| 2026-10-15 | `scripts/start.sh api` + curl `/api/health`, `/api/system` | ok; GPUs read via nvidia-smi |
| 2026-10-15 | `py/setup.sh` | torch 2.9.1+cu128, faster-whisper 1.2.1, mediapipe 1.1.1, numpy 2.4.6 in one venv (no conflict) |
| 2026-10-15 | `py/tts.py` design mode, GPU 3 | 8.56 s line in 29 s incl. model load |
| 2026-10-15 | `py/align.py` | 24 words aligned in 0.8 s (CPU) |
| 2026-10-15 | `npm test` | 2 files, 17 tests pass |
| 2026-10-15 | `npm test` | 4 files, 26 tests pass; `tsc --noEmit` clean |
| 2026-10-15 | `nash backup` → `git ls-remote nas` | NAS `main` = local HEAD `8b7e6b0` |
| 2026-10-15 | M4 proof job (CLI, real engines) | done; 13 takes; old QC flagged 5 of 8 segments |
| 2026-10-15 | Lip-sync A/B on segment 4 (same seed): as-is, no audio anchor, no dialogue, no VEDA, turbo 4-step | generated audio = input voice (corr 0.998, lag 0); SyncNet LSE-C 8.7 / 5.1 / 9.7 / 9.4 / 9.2 |
| 2026-10-15 | SyncNet calibration: 13 takes + controls (reversed voice, voice 333 ms late) | takes offset 0/−1, LSE-C 8.1–10.0; reversed 0.8; late → offset −9 |
| 2026-10-15 | `npm run sosie -- rescore` on the proof, then `py/verify_bundle.py` | 8/8 pass; whole video offset −1, LSE-C 8.9; audio exact; caption drift 0 ms |
| 2026-10-15 | `npm test` | 6 files, 35 tests pass (API lifecycle with fake engines, media trim/join regression) |
| 2026-10-15 | `py/test_qc.py` | ok (SyncNet verdicts on the measured scores) |
| 2026-10-15 | `scripts/try-character.ts` (5-step LoRA) | 4 options in 68 s (17 s each incl. first load) |
| 2026-10-15 | `scripts/try-photo.ts` | cut-out over a generated set in 23 s, no framing warnings |
| 2026-10-15 | `writeScript` via Claude Code | 6 lines with notes, 14 s |
| 2026-10-15 | build, `npm test` (6 files, 38 tests), `py/test_qc.py`, `npm run test:ui` (3 runs) | all pass |

## Decisions

- 2026-10-15 — Name: Sosie (French for a look-alike double). User suggested "CamySama or a better name".
- 2026-10-15 — Stack chosen from X/Reddit/HF research (master prompt §4).
- 2026-10-15 — M0: the four inputs sit in one NeuronKit panel as four columns (an instrument with four inputs), not a card grid, per the kit's no-card-grid rule.
- 2026-10-15 — NashGit repos `Sosie` and `MOceanX` created by the user in the web UI; pushes use the stored deploy token.

- 2026-10-15 — ComfyUI-RMBG dropped: upstream 3.2.0 fails to import without SAM/GroundingDINO deps. Cut-out moves to `py/cutout.py` with BiRefNet-general (MIT) from the shared store.
- 2026-10-15 — H3RigTools not copied: core `VAEDecodeTiled` after `LTXVSeparateAVLatent` replaces `H3GuardedVAEDecodeTiled`.
- 2026-10-15 — Talking segment anchors the TTS audio twice: as the Ref2VA `<Audio 1>` reference with `fully_copy`, and with `MiniMaxH3AddGuide` at frame 0 (pins the generated audio track to our voice).

- 2026-10-15 — Speed LoRA default: TaoMate 3-step (M2 evidence in master prompt §3.4).
- 2026-10-15 — Lip-sync QC metric changed from "lag search" to envelope-vs-reversed-voice + pause contrast: the lag search scored a well-synced clip as failing (speech rhythm creates false peaks ~11 frames away). Verified on the M2 clips and on synthetic synced/late signals (`py/test_qc.py`).

- 2026-10-15 — **Lip-sync QC is now SyncNet** (LSE-C / LSE-D / offset; master prompt §6.7). The envelope + pause metric failed 10 of 13 takes that SyncNet and a frame-by-frame look (bilabial closures on "MiniMax", rounded lips on "called") show in sync. SyncNet weights: `ByteDance/LatentSync-1.6` `auxiliary/syncnet_v2.model` (54.6 MB), archived to the NAS (logged) and synced to the store (sha256 match). The H3 audio anchor stays: without it LSE-C drops to 5.1.
- 2026-10-15 — **Bug fixed: the final video lost its last 2.7 s of voice.** An output `-frames:v` limit ended the MP4 before ffmpeg wrote the buffered audio (also in each segment's trim). The picture is now cut with a `trim` filter; `tests/media.test.ts` failed before the fix (audio 2.3 s short) and passes after.
- 2026-10-15 — The job runner's engines are injectable (`Engines` in `server/pipeline/job.ts`); `server/testing/fake-engines.ts` makes tiny real media so the API and Studio are tested end to end without GPUs.

## Awaiting user review

- M4 proof (`docs/media/m4-proof-60s.mp4`): every measure passes; please judge the lip sync, the jump cuts between segments (H3 reframes slightly per segment) and the voice.

- M2 clips (`docs/media/m2-taomate.mp4`): does the lip sync look right to you? QC passes; a human eye is still the real test.

## Blocked

