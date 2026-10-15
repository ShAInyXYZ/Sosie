#!/usr/bin/env python3
"""Lip-sync score with SyncNet (Chung & Zisserman, 2016): the standard LSE-D / LSE-C measures and the
audio-video offset. The network below is joonson/syncnet_python's SyncNetModel (MIT licence,
Copyright (c) 2016-present Joon Son Chung); the weights are `syncnet_v2.model` from
ByteDance/LatentSync-1.6 (auxiliary/). Faces are found with MediaPipe instead of S3FD.

    py/.venv/bin/python py/syncnet.py <request.json>

request.json: {"video": "<mp4>", "audio": "<wav>", "weights": "<syncnet_v2.model>",
               "landmarker": "<face_landmarker.task>", "out": "<result.json>", "device": "cuda"|"cpu"}
    → {"offset": frames at 25 fps (negative = the voice comes after the lips), "minDist": LSE-D,
       "confidence": LSE-C, "frames": n}
"""
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

VSHIFT = 15  # offsets searched: ±15 frames at 25 fps (±0.6 s)
CROP_SCALE = 0.4  # as syncnet_python's pipeline


class SyncNet(nn.Module):
    """joonson/syncnet_python SyncNetModel.S, unchanged (MIT)."""

    def __init__(self, num_layers_in_fc_layers=1024):
        super().__init__()
        self.netcnnaud = nn.Sequential(
            nn.Conv2d(1, 64, kernel_size=(3, 3), stride=(1, 1), padding=(1, 1)), nn.BatchNorm2d(64), nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=(1, 1), stride=(1, 1)),
            nn.Conv2d(64, 192, kernel_size=(3, 3), stride=(1, 1), padding=(1, 1)), nn.BatchNorm2d(192), nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=(3, 3), stride=(1, 2)),
            nn.Conv2d(192, 384, kernel_size=(3, 3), padding=(1, 1)), nn.BatchNorm2d(384), nn.ReLU(inplace=True),
            nn.Conv2d(384, 256, kernel_size=(3, 3), padding=(1, 1)), nn.BatchNorm2d(256), nn.ReLU(inplace=True),
            nn.Conv2d(256, 256, kernel_size=(3, 3), padding=(1, 1)), nn.BatchNorm2d(256), nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=(3, 3), stride=(2, 2)),
            nn.Conv2d(256, 512, kernel_size=(5, 4), padding=(0, 0)), nn.BatchNorm2d(512), nn.ReLU(),
        )
        self.netfcaud = nn.Sequential(nn.Linear(512, 512), nn.BatchNorm1d(512), nn.ReLU(), nn.Linear(512, num_layers_in_fc_layers))
        self.netfclip = nn.Sequential(nn.Linear(512, 512), nn.BatchNorm1d(512), nn.ReLU(), nn.Linear(512, num_layers_in_fc_layers))
        self.netcnnlip = nn.Sequential(
            nn.Conv3d(3, 96, kernel_size=(5, 7, 7), stride=(1, 2, 2), padding=0), nn.BatchNorm3d(96), nn.ReLU(inplace=True),
            nn.MaxPool3d(kernel_size=(1, 3, 3), stride=(1, 2, 2)),
            nn.Conv3d(96, 256, kernel_size=(1, 5, 5), stride=(1, 2, 2), padding=(0, 1, 1)), nn.BatchNorm3d(256), nn.ReLU(inplace=True),
            nn.MaxPool3d(kernel_size=(1, 3, 3), stride=(1, 2, 2), padding=(0, 1, 1)),
            nn.Conv3d(256, 256, kernel_size=(1, 3, 3), padding=(0, 1, 1)), nn.BatchNorm3d(256), nn.ReLU(inplace=True),
            nn.Conv3d(256, 256, kernel_size=(1, 3, 3), padding=(0, 1, 1)), nn.BatchNorm3d(256), nn.ReLU(inplace=True),
            nn.Conv3d(256, 256, kernel_size=(1, 3, 3), padding=(0, 1, 1)), nn.BatchNorm3d(256), nn.ReLU(inplace=True),
            nn.MaxPool3d(kernel_size=(1, 3, 3), stride=(1, 2, 2)),
            nn.Conv3d(256, 512, kernel_size=(1, 6, 6), padding=0), nn.BatchNorm3d(512), nn.ReLU(inplace=True),
        )

    def forward_aud(self, x):
        return self.netfcaud(self.netcnnaud(x).flatten(1))

    def forward_lip(self, x):
        return self.netfclip(self.netcnnlip(x).flatten(1))


def load(weights: str, device: str) -> SyncNet:
    net = SyncNet()
    state = torch.load(weights, map_location="cpu", weights_only=True)
    own = net.state_dict()
    for name, param in state.items():
        own[name.removeprefix("__S__.")].copy_(param)
    return net.to(device).eval()


def frames_25fps(video: str) -> list[np.ndarray]:
    """BGR frames resampled to 25 fps, as the network was trained."""
    import cv2
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-vf", "fps=25", "-q:v", "2", f"{tmp}/%06d.jpg"], check=True)
        return [cv2.imread(str(p)) for p in sorted(Path(tmp).glob("*.jpg"))]


def audio_16k(path: str) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.int16)


def face_crops(frames: list[np.ndarray], landmarker_path: str) -> np.ndarray | None:
    """224×224 face crops like syncnet_python's: a square around the face box, shifted down to keep the chin."""
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision
    from scipy import signal
    options = vision.FaceLandmarkerOptions(base_options=mp_python.BaseOptions(model_asset_path=landmarker_path),
                                           running_mode=vision.RunningMode.VIDEO, num_faces=1)
    boxes = []
    with vision.FaceLandmarker.create_from_options(options) as landmarker:
        for i, frame in enumerate(frames):
            h, w = frame.shape[:2]
            result = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=frame[:, :, ::-1].copy()), int(i * 40))
            if result.face_landmarks:
                xs = [p.x * w for p in result.face_landmarks[0]]
                ys = [p.y * h for p in result.face_landmarks[0]]
                boxes.append((min(xs), min(ys), max(xs), max(ys)))
            else:
                boxes.append(None)
    found = [b for b in boxes if b]
    if len(found) < len(frames) * 0.9:
        return None
    filled = [b or found[0] for b in boxes]
    s = signal.medfilt(np.array([max(b[3] - b[1], b[2] - b[0]) / 2 for b in filled]), kernel_size=13)
    y = signal.medfilt(np.array([(b[1] + b[3]) / 2 for b in filled]), kernel_size=13)
    x = signal.medfilt(np.array([(b[0] + b[2]) / 2 for b in filled]), kernel_size=13)
    crops = []
    for i, frame in enumerate(frames):
        bs = s[i]
        pad = int(bs * (1 + 2 * CROP_SCALE))
        padded = np.pad(frame, ((pad, pad), (pad, pad), (0, 0)), "constant", constant_values=110)
        my, mx = y[i] + pad, x[i] + pad
        face = padded[int(my - bs):int(my + bs * (1 + 2 * CROP_SCALE)), int(mx - bs * (1 + CROP_SCALE)):int(mx + bs * (1 + CROP_SCALE))]
        crops.append(cv2.resize(face, (224, 224)))
    return np.stack(crops)


def score(req: dict) -> dict:
    import python_speech_features
    device = req.get("device") or ("cuda" if torch.cuda.is_available() else "cpu")
    net = load(req["weights"], device)
    crops = face_crops(frames_25fps(req["video"]), req["landmarker"])
    if crops is None:
        return {"status": "no face"}
    audio = audio_16k(req["audio"])
    mfcc = np.stack(python_speech_features.mfcc(audio, 16000), axis=1)  # 13 × (100 per second)
    n = min(len(crops), math.floor(len(audio) / 640))
    last = n - 5
    if last < 2 * VSHIFT:
        return {"status": "too short"}
    video = torch.from_numpy(crops.astype(np.float32)).permute(3, 0, 1, 2).unsqueeze(0)  # 1 × 3 × T × 224 × 224 (BGR, 0–255)
    cc = torch.from_numpy(mfcc.astype(np.float32))[None, None]  # 1 × 1 × 13 × M
    lip, aud = [], []
    with torch.no_grad():
        for i in range(0, last, 20):
            idx = range(i, min(last, i + 20))
            lip.append(net.forward_lip(torch.cat([video[:, :, k:k + 5] for k in idx]).to(device)).cpu())
            aud.append(net.forward_aud(torch.cat([cc[:, :, :, k * 4:k * 4 + 20] for k in idx]).to(device)).cpu())
    lip_f, aud_f = torch.cat(lip), torch.cat(aud)
    window = 2 * VSHIFT + 1
    padded = torch.nn.functional.pad(aud_f, (0, 0, VSHIFT, VSHIFT))
    dists = torch.stack([torch.nn.functional.pairwise_distance(lip_f[[i]].repeat(window, 1), padded[i:i + window]) for i in range(len(lip_f))])
    mean = dists.mean(0)
    min_dist, min_idx = torch.min(mean, 0)
    return {
        "status": "ok",
        "offset": int(VSHIFT - min_idx.item()),
        "minDist": round(float(min_dist), 3),
        "confidence": round(float(torch.median(mean) - min_dist), 3),
        "frames": int(n),
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    request = json.loads(Path(sys.argv[1]).read_text())
    result = score(request)
    Path(request["out"]).write_text(json.dumps(result))
    print(json.dumps(result))
