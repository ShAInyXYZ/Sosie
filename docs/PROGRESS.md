# Sosie — Progress

Living checklist for [MASTER_PROMPT.md](MASTER_PROMPT.md). Each ticked item names its evidence (test, file, commit) and date.

## Milestones

- [x] Master prompt written and reviewed (v1 → independent critique → v2) — 2026-10-15
- [x] M0 Scaffold — 2026-10-15 · build passes, `npm test` 7/7 (config loader, GPU parsing), API `/api/health` + `/api/system` live on 3190, shell screenshots `docs/media/m0-studio-shell-{dark,light}.png`
- [x] M1 Own ComfyUI (+ VEDA R2VA predictor download) — 2026-10-15 · `comfy/setup.sh` built ComfyUI 0.37.1 (3f767e7f) + MultiGPU/VEDA/VHS/KJNodes at the container's pins in 7 m 46 s (`data/run/comfy-setup.log`); running on 8190 with its own I/O dirs and 67 store folders via `extra_model_paths.yaml`; `/object_info` has MiniMaxH3ReferenceToVideo, MiniMaxH3AddGuide, VedaSparseAttention (both predictors), DisTorch2 loaders, TextEncodeQwenImage21; VEDA R2VA predictor archived to NAS (275 415 752 B, logged) and synced to the store (size verified); main container StartedAt unchanged (2026-10-14T11:56:10Z before and after)
- [ ] M2 Lip-sync spike (speed-LoRA A/B, VEDA on) — before any UI work
- [ ] M3 Voice
- [ ] M4 Pipeline (CLI first, 60 s proof)
- [ ] M5 Face and look
- [ ] M6 Studio UI
- [ ] M7 Script AI
- [ ] M8 Docs and proof
- [ ] W FastH3-Omni cron + ntfy (from 2026-10-20)

## Definition of done

Mirrors §1 of the master prompt; tick with evidence.

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
| 2026-10-15 | `nash backup` → `git ls-remote nas` | NAS `main` = local HEAD `8b7e6b0` |

## Decisions

- 2026-10-15 — Name: Sosie (French for a look-alike double). User suggested "CamySama or a better name".
- 2026-10-15 — Stack chosen from X/Reddit/HF research (master prompt §4).
- 2026-10-15 — M0: the four inputs sit in one NeuronKit panel as four columns (an instrument with four inputs), not a card grid, per the kit's no-card-grid rule.
- 2026-10-15 — NashGit repos `Sosie` and `MOceanX` created by the user in the web UI; pushes use the stored deploy token.

- 2026-10-15 — ComfyUI-RMBG dropped: upstream 3.2.0 fails to import without SAM/GroundingDINO deps. Cut-out moves to `py/cutout.py` with BiRefNet-general (MIT) from the shared store.
- 2026-10-15 — H3RigTools not copied: core `VAEDecodeTiled` after `LTXVSeparateAVLatent` replaces `H3GuardedVAEDecodeTiled`.
- 2026-10-15 — Talking segment anchors the TTS audio twice: as the Ref2VA `<Audio 1>` reference with `fully_copy`, and with `MiniMaxH3AddGuide` at frame 0 (pins the generated audio track to our voice).

## Awaiting user review

## Blocked

