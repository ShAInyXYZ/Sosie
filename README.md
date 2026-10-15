<p align="center"><img src="docs/brand/banner.png" alt="Sosie: your on-camera double" width="100%"></p>

# Sosie

Sosie makes a lip-synced streamer facecam: a person talking to camera in the voice, look and words you choose, as an MP4 for the corner of a YouTube video or a Reel. Everything runs locally, on your own GPUs.

Pick a **Face** (a photo, or a character made here), a **Voice** (cloned or designed), a **Script** (typed, or written by AI from your notes) and a **Look** (the set behind the person). Press **Generate**.

Under the hood: Breeze TTS 2 (or Dots TTS) voices the script; MiniMax H3 (Singularity v1.3 Ref2VA, TaoMate 3-step LoRA, VEDA sparse attention, fp16 VAE) films it in segments on Sosie's own ComfyUI; SyncNet checks every segment's lip sync; the segments are joined under the untouched voice track, with word-timed captions.

## Setup (once)

Needs Linux with NVIDIA GPUs (built and tested on four RTX 3090s and an RTX 3060; MiniMax H3 is split over two cards), Node 22+, `uv`, ffmpeg (with rubberband) and ffprobe on `PATH`, and these models. The ComfyUI-style folders sit under `paths.modelStore`:

| Folder | Files |
|---|---|
| `diffusion_models/` | `Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors`, `qwen_image_2.1_int8_convrot.safetensors` |
| `text_encoders/` | `qwen3vl_32b_minimax_h3_int8_convrot.safetensors`, `qwen3vl_8b_int8_convrot.safetensors` |
| `vae/` | `minimax_h3_video_vae_fp16.safetensors`, `minimax_h3_audio_vae_fp32.safetensors`, `qwen_image_2.1_vae_bf16.safetensors` |
| `loras/` | `taomate_h3_3step_comfy.safetensors` (optional: `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors`); Qwen Image 2.1 LoRAs listed in `loras.qwenImage21` |
| `veda/` | `minimax_h3_r2va_veda_preview_fp8.safetensors` |
| `RMBG/BiRefNet/` | `BiRefNet-general.safetensors` |
| `syncnet/` | `syncnet_v2.model` (from `ByteDance/LatentSync-1.6`, `auxiliary/`) |

Breeze TTS 2 (`paths.breezeModel`) and faster-whisper `base` (`paths.whisperModel`) are folders of their own. Dots TTS is optional (`paths.dotsModel`, see [docs/VOICE_PROMPTING.md](docs/VOICE_PROMPTING.md)).

```sh
cp config/sosie.example.json config/sosie.local.json   # fill in this machine's paths and GPU map
npm install
comfy/setup.sh      # Sosie's own ComfyUI at pinned versions (port 8190), separate from any other ComfyUI
py/setup.sh         # Breeze TTS 2, faster-whisper, MediaPipe, SyncNet QC deps (Python 3.11 venv)
npm run build
```

The System panel lists anything missing.

## Start and stop

```sh
scripts/start.sh        # API (serves the app) on 127.0.0.1:3190, then Sosie's ComfyUI on 8190
scripts/stop.sh
```

Open <http://127.0.0.1:3190>. **System** shows a lamp per service; **Start services** starts ComfyUI if it is down. For development, `npm run dev` serves the app with hot reload on 5190.

## Use

1. **Face**: choose one, describe a new character (four options; **Advanced** has age, hair, outfit, style and the LoRA picker), or use a photo of you or someone who agreed (the person's pixels are kept; only the set is generated).
2. **Voice**: choose one, design one from a description, or (Advanced) import your own sample with its exact words.
3. **Script**: one breath per line; a bracket at the end holds the delivery note and controls, e.g. `A yawn. [dry, quietly amused; pace 0.85; pause 1.4]`, and Breeze performs `(laugh)`, `(sigh)`, `(cough)` and `(clears throat)` in the text ([docs/VOICE_PROMPTING.md](docs/VOICE_PROMPTING.md)). **Advanced → Write with AI** drafts it from your context through the Claude Code or Codex CLI signed in on this machine, written for the chosen voice engine.
4. **Look**: the set behind a photo or a new character.
5. Pick the format (**Corner** 768×768, **Reel** 576×1024, **Wide** 1024×576), then **Try first segment** to check the face and voice quickly, or **Generate**.

A finished video shows a player, the segments with their QC lamps (re-roll any of them), **Download MP4**, **Captions** and **Send to MOceanX**. On this rig filming takes about 3 minutes per 8–10 s segment, so a 60 s video takes roughly 25–35 minutes. **Settings** (gear) has the voice engine (Breeze TTS 2 follows delivery notes; Dots TTS has the cleanest sound and is optional, see the voice guide), the speed LoRA and punch-in; its Advanced view has seed, steps, a size override and full-detail references.

Every output carries an `AI-generated (Sosie)` tag in the MP4 and in its bundle.

### From the terminal

```sh
npm run sosie -- voices
npm run sosie -- faces
npm run sosie -- make script.txt --face <id> --voice <id> [--format corner|reel|wide] [--first]
npm run sosie -- resume <job-id>
npm run sosie -- reroll <job-id> <segment>
npm run sosie -- rescore <job-id>
```

### Output bundle

Each video is a folder `data/projects/<id>/out/<name>.sosie/` with `facecam.mp4`, `captions.srt`, `words.json`, `project.json` and `poster.jpg` (bundle v1). MOceanX imports it in one step (**File → Import Sosie video…**, or **Send to MOceanX** here). The QC report (`qc.html`, `qc.json`) sits next to it.

## Agents

Claude Code, Codex or any MCP client can make Sosie videos: `server/mcp.ts` exposes faces, voices (with consent-checked photo and voice imports), script writing, videos, their progress, re-rolls and the hand-off to MOceanX. Claude Code finds it in `.mcp.json`; for Codex see [AGENTS.md](AGENTS.md). The **day-recap** skill (`.claude/skills/day-recap/`) turns a day's commits and notes into a video of you explaining them: your face and voice from Sosie over an animated MOceanX explainer.

## Updates

**System → Check for updates** compares your build with the official repository and lists what is new, one line per change (click a line for details). **Update** fast-forwards to it, reinstalls packages if they changed, rebuilds the app and restarts Sosie; it tells you when a setup script needs a re-run. It never merges or overwrites: with edited files or commits of your own it stops and says so. A fork can point `update.repo` in `config/sosie.local.json` at itself.

## Tests

```sh
npm test            # unit + API (job lifecycle with fake engines) + media
npm run test:ui     # the Studio in Chromium against the real API with fake engines, both themes
npm run test:mcp    # the MCP over stdio against the real API with fake engines
py/.venv/bin/python py/test_qc.py
```

## Licences

Sosie's own code is under the [MIT licence](LICENSE). The models it drives have their own terms, and **you are responsible for following them**:

- **MiniMax H3 weights**: the licence excludes the **EU, the UK, South Korea and the US** ("Excluded Territories"). Its section 4 says the works **and their outputs** may not be used, reproduced, distributed or displayed outside the permitted territory. MiniMax invites people in excluded territories to ask for a licence. **If you publish from the EU, get MiniMax's authorisation first.** This is a legal decision for you, not for Sosie.
- **Breeze TTS 2**: BreezeBlue research and **non-commercial** licence.
- **Dots TTS** (dots.tts SOAR, optional): Apache-2.0.
- **Qwen Image 2.1** (and its LoRAs): research licence.
- Helpers: faster-whisper (MIT), MediaPipe (Apache 2.0), BiRefNet (MIT), SyncNet network (MIT, joonson/syncnet_python) with weights from LatentSync (OpenRAIL++), NeuronKit UI (see `vendor/neuronkit/LICENSE`).

Measured facts and decisions: [docs/NOTES.md](docs/NOTES.md). How it works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). HTTP API: [docs/API.md](docs/API.md). Voice prompting: [docs/VOICE_PROMPTING.md](docs/VOICE_PROMPTING.md).
