#!/usr/bin/env python3
"""Quality control for one talking segment (after trim and mux, before join).

    py/.venv/bin/python py/qc.py <request.json>

request.json: {"video": "<segment.mp4>", "audio": "<segment audio wav, same timeline>", "frames": <expected n>,
               "landmarker": "<face_landmarker.task>", "out": "<qc.json>",
               "words": [{"word", "start", "end"}, ...]  (optional, seconds on the segment's timeline)}

Checks: exact frame count; no black, frozen or noise-spike frames; a face in >= 95% of frames; lip sync.
Lip sync has two parts, because speech is rhythmic and a plain lag search finds false peaks one word
period away (seen on the first H3 clip):
  - envelope: mouth opening vs the voice's loudness at offsets -2..+2 frames must beat the same
    measure against the time-reversed voice (same rhythm, wrong words) by >= 0.20;
  - pauses (when word timings are given and the clip has pauses): the mouth must be clearly more open
    during words than in pauses at offsets -2..+2 (ratio >= 1.2), and more so than at 8..16 frames off.
A segment with no face at all is "unscored" (e.g. a stylised character), not failed.
"""
import json
import sys
from pathlib import Path

import numpy as np

FPS = 24
ENVELOPE_MARGIN = 0.20
PAUSE_RATIO = 1.2
LATE_MARGIN = 0.15
FACE_MIN = 0.95


def read_frames(path: str):
    import cv2
    cap = cv2.VideoCapture(path)
    frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
    cap.release()
    return frames


def frame_checks(frames: list) -> dict:
    gray = np.stack([f.mean(axis=2) for f in frames]).astype(np.float32)
    luma = gray.mean(axis=(1, 2))
    diffs = np.abs(np.diff(gray, axis=0)).mean(axis=(1, 2)) if len(gray) > 1 else np.zeros(0)
    black = int((luma < 8).sum())
    # frozen: a run of >= 12 frames (0.5 s) with almost no change
    frozen_run, longest = 0, 0
    for d in diffs:
        frozen_run = frozen_run + 1 if d < 0.05 else 0
        longest = max(longest, frozen_run)
    # noise spike: one frame far from both neighbours compared with the clip's own motion
    spikes = 0
    if len(diffs) >= 3:
        med = float(np.median(diffs)) + 1e-6
        mad = float(np.median(np.abs(diffs - med))) + 1e-6
        for i in range(len(diffs) - 1):
            if (diffs[i] - med) / mad > 25 and (diffs[i + 1] - med) / mad > 25:
                spikes += 1
    return {"blackFrames": black, "longestFrozenRun": int(longest), "noiseSpikes": spikes,
            "ok": black == 0 and longest < 12 and spikes == 0}


def mouth_series(frames: list, landmarker_path: str) -> tuple[np.ndarray, float]:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision
    options = vision.FaceLandmarkerOptions(base_options=mp_python.BaseOptions(model_asset_path=landmarker_path),
                                           running_mode=vision.RunningMode.VIDEO, num_faces=1)
    series, found = [], 0
    with vision.FaceLandmarker.create_from_options(options) as landmarker:
        for i, frame in enumerate(frames):
            rgb = frame[:, :, ::-1].copy()
            result = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(i * 1000 / FPS))
            if result.face_landmarks:
                lm = result.face_landmarks[0]
                face_h = abs(lm[152].y - lm[10].y) or 1e-6
                series.append(abs(lm[14].y - lm[13].y) / face_h)  # inner lips apart ÷ face height
                found += 1
            else:
                series.append(np.nan)
    return np.array(series, dtype=np.float64), found / max(1, len(frames))


def audio_envelope(path: str, n: int) -> np.ndarray:
    import soundfile as sf
    audio, rate = sf.read(path, always_2d=True)
    mono = audio.mean(axis=1)
    hop = rate / FPS
    env = np.array([np.sqrt(np.mean(mono[int(i * hop):int((i + 1) * hop)] ** 2)) if int(i * hop) < len(mono) else 0.0
                    for i in range(n)])
    return env


def corr_at(a: np.ndarray, b: np.ndarray, offset: int) -> float:
    """Correlation of a[t] with b[t + offset], ignoring frames without a face."""
    if offset >= 0:
        x, y = a[: len(a) - offset], b[offset:]
    else:
        x, y = a[-offset:], b[: len(b) + offset]
    mask = ~(np.isnan(x) | np.isnan(y))
    if mask.sum() < 24 or np.std(x[mask]) == 0 or np.std(y[mask]) == 0:
        return float("nan")
    return float(np.corrcoef(x[mask], y[mask])[0, 1])


def smooth(x: np.ndarray) -> np.ndarray:
    kernel = np.ones(3) / 3
    filled = np.nan_to_num(x, nan=np.nanmean(x) if np.isfinite(np.nanmean(x)) else 0.0)
    out = np.convolve(filled, kernel, mode="same")
    out[np.isnan(x)] = np.nan
    return out


def best_near(a: np.ndarray, b: np.ndarray) -> float:
    values = [v for v in (corr_at(a, b, o) for o in range(-2, 3)) if not np.isnan(v)]
    return max(values) if values else float("nan")


def envelope_check(mouth: np.ndarray, env: np.ndarray) -> dict:
    m, e = smooth(mouth), np.convolve(env, np.ones(3) / 3, mode="same")
    near = best_near(m, e)
    control = best_near(m, e[::-1].copy())
    margin = near - control
    return {"near": round(near, 3), "reversedControl": round(control, 3), "margin": round(margin, 3),
            "pass": bool(np.isfinite(margin) and margin >= ENVELOPE_MARGIN)}


def speech_mask(words: list, n: int) -> np.ndarray:
    mask = np.zeros(n, bool)
    for w in words:
        mask[max(0, int(w["start"] * FPS)):min(n, int(np.ceil(w["end"] * FPS)))] = True
    return mask


def pause_check(mouth: np.ndarray, words: list) -> dict:
    n = len(mouth)
    speech = speech_mask(words, n)
    m = np.nan_to_num(mouth, nan=np.nanmean(mouth))
    if speech.sum() < FPS or (~speech).sum() < FPS // 2:
        return {"status": "not applicable (too few pause frames)"}

    def ratio(shift: int) -> float:
        sp = np.roll(speech, shift)
        off = m[~sp].mean()
        return float(m[sp].mean() / off) if off > 0 else float("nan")

    near = max(ratio(s) for s in range(-2, 3))
    far = max(ratio(s) for s in [*range(8, 17), *range(-16, -7)])
    # Continuous speech has short gaps, so a wrong offset can score almost as well as the right one;
    # only a clearly better wrong offset means the lips run late/early.
    return {"nearRatio": round(near, 3), "farRatio": round(far, 3),
            "pass": bool(near >= PAUSE_RATIO and far - near < LATE_MARGIN)}


def sync_score(mouth: np.ndarray, env: np.ndarray, words: list | None) -> dict:
    envelope = envelope_check(mouth, env)
    pauses = pause_check(mouth, words) if words else {"status": "not applicable (no word timings)"}
    passed = envelope["pass"] and pauses.get("pass", True)
    return {"envelope": envelope, "pauses": pauses, "pass": bool(passed)}


def run(req: dict) -> dict:
    frames = read_frames(req["video"])
    result = {"video": req["video"], "frames": len(frames), "expectedFrames": req.get("frames")}
    result["duration"] = {"ok": req.get("frames") is None or len(frames) == req["frames"]}
    result["clean"] = frame_checks(frames) if frames else {"ok": False}
    mouth, face_ratio = mouth_series(frames, req["landmarker"]) if frames else (np.array([]), 0.0)
    result["face"] = {"ratio": round(face_ratio, 3), "ok": face_ratio >= FACE_MIN}
    if face_ratio == 0:
        result["lipSync"] = {"status": "unscored"}
    else:
        env = audio_envelope(req["audio"], len(frames))
        result["lipSync"] = sync_score(mouth, env, req.get("words"))
    lip_ok = result["lipSync"].get("pass", True)
    result["pass"] = bool(result["duration"]["ok"] and result["clean"]["ok"] and (face_ratio == 0 or result["face"]["ok"]) and lip_ok)
    return result


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    request = json.loads(Path(sys.argv[1]).read_text())
    report = run(request)
    Path(request["out"]).write_text(json.dumps(report, indent=1))
    print(json.dumps(report))
