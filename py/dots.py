#!/usr/bin/env python3
"""Dots TTS (SOAR), one shot: load the model, voice every line, exit (frees the GPU before H3 runs).

    py/dots-tts/.venv/bin/python py/dots.py <request.json>

request.json:
    {
      "model": "<dots.tts-soar dir>",           # official dots-studio/dots.tts-soar layout
      "out": "<dir>",                           # writes 01.wav, 02.wav, … (48 kHz) and lines.json
      "seed": 42, "steps": 15, "cfg": 1.2,
      "refAudio": "<wav>", "refText": "<its exact transcript>",
      "lines": [{"text": "…"}]
    }

Dots clones by continuation: it copies the reference's timbre, pace and mood and reads the text's punctuation.
It has no instruction input, so delivery notes are not passed (Sosie shapes pace and pauses afterwards).
The caller picks the GPU with CUDA_VISIBLE_DEVICES; this script always uses cuda:0.
"""
import json
import os
import sys
from pathlib import Path


def speak(req: dict) -> list[dict]:
    import soundfile as sf
    import torch
    from dots_tts.runtime import DotsTtsRuntime

    out = Path(req["out"])
    out.mkdir(parents=True, exist_ok=True)
    seed, steps, cfg = int(req.get("seed", 42)), int(req.get("steps", 15)), float(req.get("cfg", 1.2))
    runtime = DotsTtsRuntime.from_pretrained(str(Path(req["model"]).resolve()), precision="bfloat16")
    done = []
    for i, line in enumerate(req["lines"], 1):
        text = line["text"].strip()
        torch.manual_seed(seed)
        with torch.inference_mode():
            result = runtime.generate(text=text, prompt_audio_path=req["refAudio"], prompt_text=req["refText"],
                                      num_steps=steps, guidance_scale=cfg)
        audio = result["audio"].float().cpu().squeeze().numpy()
        path = out / f"{i:02d}.wav"
        sf.write(path, audio, result["sample_rate"], subtype="PCM_16")
        duration = len(audio) / result["sample_rate"]
        done.append({"text": text, "file": path.name, "durationS": round(duration, 3), "sampleRate": result["sample_rate"]})
        print(json.dumps({"line": i, "durationS": round(duration, 3)}), flush=True)
    (out / "lines.json").write_text(json.dumps(done, indent=1))
    return done


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    speak(json.loads(Path(sys.argv[1]).read_text()))
