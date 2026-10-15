# Engineering notes

Measured facts and the decisions they led to. Code layout is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Video (MiniMax H3)

- **Audio anchor.** A talking segment feeds the voice twice: as the Ref2VA `<Audio 1>` reference with
  `fully_copy`, and through `MiniMaxH3AddGuide` at frame 0. Without the guide, lip sync drops to LSE-C 5.1.
- **Decoder.** Core `VAEDecodeTiled` after `LTXVSeparateAVLatent` decodes the video.
- **Quality defaults** (A/B on one clip, same seed and voice; `scripts/ab-quality.ts`,
  [face crops](media/q1-quality-faces.jpg)): 640 px with the int8 video VAE took 202 s at LSE-C 8.79; 768 px with
  the fp16 VAE and the full-detail reference took 220 s (+9 %) at LSE-C 9.00, with visibly sharper lashes, teeth
  and hair. These are the defaults (Corner 768×768). Some identity drift from the key frame remains.
- **Above 768.** VEDA's tiles fit sizes divisible by 256 px (768, 1024); 1088² pads 20 % of them and runs out of
  memory on a 24 GB card at the first step. 1024² fits (peak 23.2 GB) and is sharper again, at +70 % time; it is
  an Advanced width, not the default. One 1024² take showed a single over-exposed frame.
- **Memory.** The compute card peaks at 14.4 GB at 768² (fp16 VAE, full-detail reference).
- **Speed LoRA.** TaoMate 3-step is the default; Turbo 4-step is the alternative.

## Lip-sync check

SyncNet (LSE-C, LSE-D, offset at 25 fps) scores every take: a pass is offset −3…+1 frames, LSE-C ≥ 6 and
LSE-D ≤ 9. An earlier envelope-and-pause metric failed takes that SyncNet and a frame-by-frame look showed in sync,
so it was replaced. Weights: `ByteDance/LatentSync-1.6`, `auxiliary/syncnet_v2.model`.

## Audio and encoding

- **Never cut with `-frames:v`.** An output frame limit ends the MP4 before ffmpeg writes the buffered audio
  (the final video once lost 2.7 s of voice). Pictures are cut with `trim` filters; `tests/media.test.ts` guards it.
- **Never pad with a zero-length `apad`.** Without a positive duration it pads forever; a zero pause passes the line
  through unchanged (`gapFilter`) and the join is capped at its known length.
- **Encode chain:** render CRF 4, segment CRF 10, final CRF 14 (`slow`). Against the raw render this keeps
  45.7 dB PSNR, against 42.7 dB for the earlier 12/14/18 chain.

## Voice

- Each line is voiced on its own, trimmed to its speech (Dots leaves up to 0.9 s of silence around a line),
  stretched to its `pace` (rubberband, pitch kept) and followed by its `pause` (default 0.5 s after a sentence,
  0.3 s inside one). Loudness is normalised once, to −16 LUFS, on the joined track.
- Breeze TTS 2 follows delivery notes (Voice Direction, CFG 4) and vocal events; Dots TTS clones by continuation
  and has no instruction input. Details: [VOICE_PROMPTING.md](VOICE_PROMPTING.md).

## Faces

The photo cut-out uses BiRefNet-general (`py/cutout.py`), with framing checks (one face, size, centre, yaw)
reported as warnings.

## Testing

The job runner's engines are injectable (`Engines` in `server/pipeline/job.ts`); `server/testing/fake-engines.ts`
makes small real media, so the API, the Studio and the MCP are tested end to end without GPUs.

## Updates

`server/update.ts` fetches the official branch into `FETCH_HEAD` only, lists the new commits as patch notes and
fast-forwards; edited files or local commits stop it with the reason.
