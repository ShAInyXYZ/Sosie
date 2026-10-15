#!/usr/bin/env bash
# Build Sosie's own ComfyUI from comfy/lock.json: pinned ComfyUI + custom nodes in comfy/ComfyUI,
# a Python venv in comfy/.venv (uv), and comfy/extra_model_paths.yaml pointing at the shared
# model store. Safe to re-run: it only checks out pins and installs what's missing.
set -euo pipefail
cd "$(dirname "$0")/.."
LOCK=comfy/lock.json
UV=${UV:-uv}
q() { python3 -c "import json,sys; d=json.load(open('$LOCK')); print(eval(sys.argv[1]))" "$1"; }

checkout() { # repo dir commit
  if [ ! -d "$2/.git" ]; then git clone -q --filter=blob:none "$1" "$2"; fi
  git -C "$2" fetch -q origin 2>/dev/null || true
  git -C "$2" checkout -q "$3"
  echo "  $(basename "$2") @ $(git -C "$2" rev-parse --short HEAD)"
}

echo "ComfyUI"
checkout "$(q "d['comfyui']['repo']")" comfy/ComfyUI "$(q "d['comfyui']['commit']")"

echo "Custom nodes"
count=$(q "len(d['nodes'])")
for i in $(seq 0 $((count - 1))); do
  name=$(q "d['nodes'][$i]['name']")
  checkout "$(q "d['nodes'][$i]['repo']")" "comfy/ComfyUI/custom_nodes/$name" "$(q "d['nodes'][$i]['commit']")"
done

echo "Python $(q "d['python']") venv"
[ -x comfy/.venv/bin/python ] || "$UV" venv -q --python "$(q "d['python']")" comfy/.venv
PY=comfy/.venv/bin/python

echo "torch (CUDA 12.8)"
# shellcheck disable=SC2046
"$UV" pip install -q --python "$PY" --index-url "$(q "d['torch']['index']")" $(q "' '.join(d['torch']['packages'])")

echo "ComfyUI requirements (constrained to the pinned versions)"
"$UV" pip install -q --python "$PY" -r comfy/ComfyUI/requirements.txt -c comfy/constraints.txt

echo "Custom node requirements"
extra=$(q "' '.join(sorted({p for n in d['nodes'] for p in n['pip']}))")
# shellcheck disable=SC2086
[ -z "$extra" ] || "$UV" pip install -q --python "$PY" -c comfy/constraints.txt $extra

echo "Model paths"
npx tsx comfy/extra-paths.ts

"$PY" -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), 'gpus', torch.cuda.device_count())"
echo "Done. Start it with: scripts/start.sh comfy"
