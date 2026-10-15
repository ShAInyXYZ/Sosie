#!/usr/bin/env bash
# Start Sosie's services in the background: API (serves the built app), and
# Sosie's own ComfyUI once comfy/setup.sh has installed it. Pids and logs go to data/run/.
# Usage: scripts/start.sh [api|comfy|all]   (default: all)
set -euo pipefail
cd "$(dirname "$0")/.."
RUN=data/run
mkdir -p "$RUN"

port() { npx tsx scripts/config-get.ts "ports.$1"; }

running() { [ -f "$RUN/$1.pid" ] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }

wait_http() { # url, seconds
  for _ in $(seq 1 "$2"); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 1; done
  return 1
}

start_api() {
  if running api; then echo "api: already running"; return; fi
  nohup npx tsx server/index.ts >"$RUN/api.log" 2>&1 &
  echo $! >"$RUN/api.pid"
  local p; p=$(port api)
  wait_http "http://127.0.0.1:$p/api/health" 30 && echo "api: http://127.0.0.1:$p" || { echo "api: failed, see $RUN/api.log"; exit 1; }
}

start_comfy() {
  if [ ! -f comfy/ComfyUI/main.py ]; then echo "comfy: not installed (run comfy/setup.sh)"; return; fi
  if running comfy; then echo "comfy: already running"; return; fi
  local args; args=$(npx tsx comfy/launch-args.ts)
  # shellcheck disable=SC2086
  CUDA_DEVICE_ORDER=PCI_BUS_ID nohup comfy/.venv/bin/python comfy/ComfyUI/main.py $args >"$RUN/comfy.log" 2>&1 &
  echo $! >"$RUN/comfy.pid"
  local p; p=$(port comfy)
  wait_http "http://127.0.0.1:$p/system_stats" 240 && echo "comfy: http://127.0.0.1:$p" || { echo "comfy: failed, see $RUN/comfy.log"; exit 1; }
}

case "${1:-all}" in
  api) start_api ;;
  comfy) start_comfy ;;
  all) start_api; start_comfy ;;
  *) echo "usage: $0 [api|comfy|all]"; exit 2 ;;
esac
