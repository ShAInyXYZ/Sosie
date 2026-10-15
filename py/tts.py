#!/usr/bin/env python3
"""Breeze TTS 2, one shot: load the model, voice every line, exit (frees the GPU before H3 runs).

    py/.venv/bin/python py/tts.py <request.json>

request.json:
    {
      "model": "<breeze-model dir>",            # Breeze TTS 2 weights
      "out": "<dir>",                           # writes 01.wav, 02.wav, … and lines.json
      "seed": 42,
      "voice": {"mode": "clone", "refAudio": "<wav>", "refText": "<its transcript>"}
             | {"mode": "design", "instruction": "<voice description>"},
      "lines": [{"text": "…", "direction": "…optional delivery note…"}]
    }

Modes (breeze-tts templates): clone = ref audio + transcript; clone with a direction = Voice Direction;
design = instruction only (no reference). Directed and designed lines use CFG 4 (Breeze's recommendation).
The caller picks the GPU with CUDA_VISIBLE_DEVICES; this script always uses cuda:0.
"""
import json
import os
import sys
from contextlib import closing
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "breeze-tts"))

CFG_GUIDED = 4.0


def speak(req: dict) -> list[dict]:
    import soundfile as sf
    import torch
    from breeze_infer.runtime import load_runtime, set_all_seeds, update_generation_config_for_breeze
    from breeze_infer.templates import get_template, prepare_inputs, select_template_name
    from models.fast_streaming import FastBreezeStreamingRuntime, FastStreamingConfig

    voice, seed, out = req["voice"], int(req.get("seed", 42)), Path(req["out"])
    out.mkdir(parents=True, exist_ok=True)
    tokenizer, model, codec = load_runtime(Path(req["model"]).resolve(), device="cuda:0", attn_implementation="eager")
    update_generation_config_for_breeze(model)
    runtime = FastBreezeStreamingRuntime(
        model, codec,
        FastStreamingConfig(max_new_tokens=1500, max_seq_len=2048, repetition_penalty=1.1,
                            fast_backbone_decode=True, fast_depth_decoder=True),
        tokenizer=tokenizer,
    )
    done = []
    for i, line in enumerate(req["lines"], 1):
        text = line["text"].strip()
        direction = (line.get("direction") or "").strip()
        request = {"id": f"line{i}", "text": text, "speaker": "S0"}
        if voice["mode"] == "clone":
            request["ref_audio_path"] = voice["refAudio"]
            request["ref_text"] = voice["refText"]
            if direction:
                request["instruction"] = direction
        elif voice["mode"] == "design":
            # a designed voice has no reference; the delivery note joins the description
            request["instruction"] = voice["instruction"] + (f" {direction}" if direction else "")
        else:
            raise ValueError(f"unknown voice mode: {voice['mode']}")
        guided = "instruction" in request
        with torch.inference_mode():
            set_all_seeds(seed)
            inputs = prepare_inputs(tokenizer, codec, model, [request], get_template(select_template_name(request)),
                                    guidance_scale=CFG_GUIDED if guided else 1, guidance_scale_ref=None, guidance_scale_ins=None)
            path = out / f"{i:02d}.wav"
            with sf.SoundFile(path, mode="w", samplerate=runtime.sample_rate, channels=1, format="WAV", subtype="PCM_16") as f:
                with closing(runtime.iter_audio_chunks(inputs, request_id=f"line{i}", seed=seed)) as chunks:
                    for chunk in chunks:
                        f.write(chunk.audio)
        duration = sf.info(str(path)).duration
        done.append({"text": text, "direction": direction, "file": path.name, "durationS": round(duration, 3),
                     "sampleRate": runtime.sample_rate})
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
