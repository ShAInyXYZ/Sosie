#!/usr/bin/env python3
"""Quality control for one talking segment (after trim and mux, before join).

    py/.venv/bin/python py/qc.py <request.json>

request.json: {"video": "<segment.mp4>", "audio": "<segment audio wav, same timeline>", "frames": <expected n>,
               "landmarker": "<face_landmarker.task>", "out": "<qc.json>"}

Checks: exact frame count; no black, frozen or noise-spike frames; a face in >= 95% of frames;
lip sync = how well mouth opening tracks the voice at the true timing (best of offsets -2..+2 frames)
minus how well it tracks at a wrong timing (best of offsets 12..36 frames either way). Pass at >= 0.10.
A segment with no face at all is "unscored" (e.g. a stylised character), not failed.
"""
import json
import sys
from pathlib import Path

import numpy as np

FPS = 24
SYNC_PASS = 0.10
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


def sync_score(mouth: np.ndarray, env: np.ndarray) -> dict:
    # smooth both a little: mouth shapes lead/lag phonemes by a frame or two
    kernel = np.ones(3) / 3
    m = np.convolve(np.nan_to_num(mouth, nan=np.nanmean(mouth)), kernel, mode="same")
    m[np.isnan(mouth)] = np.nan
    e = np.convolve(env, kernel, mode="same")
    near = {o: corr_at(m, e, o) for o in range(-2, 3)}
    far = {o: corr_at(m, e, o) for o in [*range(12, 37), *range(-36, -11)]}
    best_near = max((v for v in near.values() if not np.isnan(v)), default=float("nan"))
    best_far = max((v for v in far.values() if not np.isnan(v)), default=float("nan"))
    score = best_near - best_far
    return {"near": round(best_near, 3), "far": round(best_far, 3), "score": round(score, 3),
            "bestOffset": max(near, key=lambda o: -1 if np.isnan(near[o]) else near[o]), "pass": bool(score >= SYNC_PASS)}


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
        result["lipSync"] = sync_score(mouth, env)
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
