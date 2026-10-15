#!/usr/bin/env python3
"""Checks a finished Output bundle end to end (the M4 proof checks):

  - lip sync of the whole joined video (SyncNet, as in qc.py);
  - the audio is the exact TTS track: correlation and lag against the voice WAV, at the start and at
    the end (a lag that differs between the two would be drift);
  - captions follow the final audio: faster-whisper hears the bundle's own audio again and its word
    times are compared with words.json.

    py/.venv/bin/python py/verify_bundle.py <request.json>

request.json: {"bundle": "<x.sosie dir>", "voice": "<voice.wav>", "syncnet": "<syncnet_v2.model>",
               "landmarker": "<face_landmarker.task>", "whisper": "<faster-whisper model dir>", "out": "<report.json>"}
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import align  # noqa: E402
import qc  # noqa: E402
import syncnet  # noqa: E402

FPS = 24
RATE = 16000


def pcm(path: str) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float64)


def lag_and_corr(a: np.ndarray, b: np.ndarray, max_lag: int) -> tuple[int, float]:
    """Lag (samples, + = b later) maximising the correlation of a and b, and that correlation."""
    best = (0, -1.0)
    n = min(len(a), len(b)) - 2 * max_lag
    for lag in range(-max_lag, max_lag + 1):
        x = a[max_lag:max_lag + n]
        y = b[max_lag + lag:max_lag + lag + n]
        c = float(np.corrcoef(x, y)[0, 1])
        if c > best[1]:
            best = (lag, c)
    return best


def run(req: dict) -> dict:
    bundle = Path(req["bundle"])
    video = str(bundle / "facecam.mp4")
    report: dict = {}

    report["lipSync"] = qc.sync_verdict(syncnet.score({"video": video, "audio": video, "weights": req["syncnet"],
                                                       "landmarker": req["landmarker"], "device": "cpu"}))

    final, voice = pcm(video), pcm(req["voice"])
    ten = min(10 * RATE, len(voice) // 2)  # windows at both ends, never overlapping on a short video
    window = int(0.02 * RATE)
    start = lag_and_corr(voice[:ten], final[:ten], window)
    end_v, end_f = voice[len(voice) - ten:], final[len(voice) - ten:len(voice)]
    end = lag_and_corr(end_v, end_f, window)
    report["audio"] = {
        "voiceSeconds": round(len(voice) / RATE, 3), "videoAudioSeconds": round(len(final) / RATE, 3),
        "start": {"lagMs": round(start[0] / RATE * 1000, 2), "correlation": round(start[1], 4)},
        "end": {"lagMs": round(end[0] / RATE * 1000, 2), "correlation": round(end[1], 4)},
    }
    report["audio"]["exact"] = bool(abs(start[0]) <= 1 and abs(end[0]) <= 1 and start[1] > 0.98 and end[1] > 0.98)

    words = json.loads((bundle / "words.json").read_text())
    text = " ".join(w["word"] for w in words)
    wav = Path(req["out"]).with_suffix(".wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-ac", "1", "-ar", "16000", str(wav)], check=True)
    heard = align.align({"model": req["whisper"], "wav": str(wav), "text": text})
    wav.unlink()
    deltas = np.array([abs(h["start"] - w["start"]) for h, w in zip(heard, words)])
    first, last = deltas[:10], deltas[-10:]
    report["captions"] = {
        "words": len(words),
        "medianMs": round(float(np.median(deltas)) * 1000, 1),
        "firstTenMedianMs": round(float(np.median(first)) * 1000, 1),
        "lastTenMedianMs": round(float(np.median(last)) * 1000, 1),
        # drift: the end agrees with the start to within one frame
        "driftMs": round(abs(float(np.median(last)) - float(np.median(first))) * 1000, 1),
    }
    report["captions"]["inSync"] = bool(report["captions"]["driftMs"] < 1000 / FPS and report["captions"]["medianMs"] < 1000 / FPS)
    report["pass"] = bool(report["lipSync"]["pass"] and report["audio"]["exact"] and report["captions"]["inSync"])
    return report


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    request = json.loads(Path(sys.argv[1]).read_text())
    result = run(request)
    Path(request["out"]).write_text(json.dumps(result, indent=1))
    print(json.dumps(result))
