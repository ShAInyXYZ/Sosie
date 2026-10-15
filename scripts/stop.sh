#!/usr/bin/env bash
# Stop Sosie's background services started by scripts/start.sh.
# Usage: scripts/stop.sh [api|comfy|all]   (default: all)
set -euo pipefail
cd "$(dirname "$0")/.."
RUN=data/run

stop() {
  local pidfile="$RUN/$1.pid"
  if [ ! -f "$pidfile" ]; then echo "$1: not running"; return; fi
  local pid; pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
    echo "$1: stopped"
  else
    echo "$1: not running"
  fi
  rm -f "$pidfile"
}

case "${1:-all}" in
  api) stop api ;;
  comfy) stop comfy ;;
  all) stop comfy; stop api ;;
  *) echo "usage: $0 [api|comfy|all]"; exit 2 ;;
esac
