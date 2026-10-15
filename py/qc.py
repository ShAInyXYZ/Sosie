#!/usr/bin/env python3
"""Quality control for one talking segment (after trim and mux, before join).

    py/.venv/bin/python py/qc.py <request.json>

request.json: {"video": "<segment.mp4>", "audio": "<segment audio wav, same timeline>", "frames": <expected n>,
               "landmarker": "<face_landmarker.task>", "syncnet": "<syncnet_v2.model>", "out": "<qc.json>"}

Checks: exact frame count; no black, frozen or noise-spike frames; a face in >= 95% of frames; lip sync.
Lip sync is SyncNet's (py/syncnet.py): the audio-video offset and the LSE-C / LSE-D scores. The first
QC (mouth opening vs loudness) failed segments that were in sync — wide "ee" vowels open the lips with
little energy — so it was replaced (docs/PROGRESS.md, 2026-10-15).
A segment with no face at all is "unscored" (e.g. a stylised character), not failed.
"""
import json
import sys
from pathlib import Path

import numpy as np

FPS = 24
FACE_MIN = 0.95
# Calibrated on the first 60 s proof (13 H3 takes) and controls; see docs/MASTER_PROMPT.md §6.7.
MIN_CONFIDENCE = 6.0  # LSE-C: in-sync takes 8.1–10.0; no audio anchor 5.1; time-reversed voice 0.8
MAX_DISTANCE = 9.0  # LSE-D: in-sync takes 6.6–8.4; no audio anchor 11.1; time-reversed voice 15.8
# Offset in frames at 25 fps; negative = the voice comes after the lips. The voice may trail by up to
# 120 ms or lead by 40 ms (ITU-R BT.1359 detectability: audio 45 ms early, 125 ms late).
OFFSET_RANGE = (-3, 1)


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


def sync_verdict(score: dict) -> dict:
    """Pass/fail from a SyncNet score (py/syncnet.py)."""
    if score.get("status") != "ok":  # no face or too short: the face and duration checks decide
        return {**score, "pass": True}
    ok = (OFFSET_RANGE[0] <= score["offset"] <= OFFSET_RANGE[1]
          and score["confidence"] >= MIN_CONFIDENCE and score["minDist"] <= MAX_DISTANCE)
    return {**score, "pass": bool(ok)}


def lip_sync(req: dict) -> dict:
    weights = req.get("syncnet")
    if not weights or not Path(weights).exists():
        return {"status": "unscored (SyncNet weights not found)", "pass": True}
    import syncnet
    return sync_verdict(syncnet.score({"video": req["video"], "audio": req["audio"], "weights": weights,
                                       "landmarker": req["landmarker"], "device": req.get("device", "cpu")}))


def run(req: dict) -> dict:
    frames = read_frames(req["video"])
    result = {"frames": len(frames), "expectedFrames": req.get("frames")}
    result["duration"] = {"ok": req.get("frames") is None or len(frames) == req["frames"]}
    result["clean"] = frame_checks(frames) if frames else {"ok": False}
    mouth, face_ratio = mouth_series(frames, req["landmarker"]) if frames else (np.array([]), 0.0)
    result["face"] = {"ratio": round(face_ratio, 3), "ok": face_ratio >= FACE_MIN}
    result["lipSync"] = {"status": "unscored"} if face_ratio == 0 else lip_sync(req)
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
