#!/usr/bin/env bash
# Build Sosie's Python tools venv (py/.venv, Python 3.11 via uv): Breeze TTS 2 at the pinned commit,
# faster-whisper for word timings, mediapipe for lip-sync QC. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
UV=${UV:-uv}
BREEZE_REPO=https://github.com/breezeblue-ai/breeze-tts
BREEZE_COMMIT=008f769   # Cerveau Hub's working checkout (2026-10-15)

echo "breeze-tts @ $BREEZE_COMMIT"
[ -d py/breeze-tts/.git ] || git clone -q --filter=blob:none "$BREEZE_REPO" py/breeze-tts
git -C py/breeze-tts fetch -q origin 2>/dev/null || true
git -C py/breeze-tts checkout -q "$BREEZE_COMMIT"

echo "Python 3.11 venv"
[ -x py/.venv/bin/python ] || "$UV" venv -q --python 3.11 py/.venv
PY=py/.venv/bin/python

echo "Breeze requirements (constrained to the tested versions)"
"$UV" pip install -q --python "$PY" -r py/breeze-tts/requirements.txt -c py/constraints.txt

echo "faster-whisper, mediapipe"
"$UV" pip install -q --python "$PY" -c py/constraints.txt faster-whisper mediapipe

"$PY" - <<'EOF'
import torch, faster_whisper, mediapipe, numpy
print("torch", torch.__version__, "cuda", torch.cuda.is_available(), "| faster-whisper", faster_whisper.__version__,
      "| mediapipe", mediapipe.__version__, "| numpy", numpy.__version__)
EOF

MODEL=py/models/face_landmarker.task
if [ ! -s "$MODEL" ]; then
  mkdir -p py/models
  curl -fsSL -o "$MODEL" https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
fi
echo "face landmarker: $(stat -c %s "$MODEL") bytes"
echo "Done."
