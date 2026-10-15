# Sosie — Progress

Living checklist for [MASTER_PROMPT.md](MASTER_PROMPT.md). Each ticked item names its evidence (test, file, commit) and date.

## Milestones

- [x] Master prompt written and reviewed (v1 → independent critique → v2) — 2026-10-15
- [x] M0 Scaffold — 2026-10-15 · build passes, `npm test` 7/7 (config loader, GPU parsing), API `/api/health` + `/api/system` live on 3190, shell screenshots `docs/media/m0-studio-shell-{dark,light}.png`
- [ ] M1 Own ComfyUI (+ VEDA R2VA predictor download)
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
| 2026-10-15 | `nash backup` → `git ls-remote nas` | NAS `main` = local HEAD `8b7e6b0` |

## Decisions

- 2026-10-15 — Name: Sosie (French for a look-alike double). User suggested "CamySama or a better name".
- 2026-10-15 — Stack chosen from X/Reddit/HF research (master prompt §4).
- 2026-10-15 — M0: the four inputs sit in one NeuronKit panel as four columns (an instrument with four inputs), not a card grid, per the kit's no-card-grid rule.
- 2026-10-15 — NashGit repos `Sosie` and `MOceanX` created by the user in the web UI; pushes use the stored deploy token.

## Awaiting user review

## Blocked

