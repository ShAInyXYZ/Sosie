#!/usr/bin/env bash
# Daily release watch (master prompt §4.5): FastH3-Omni (FastVideo + Nuva Lab + Reactor), announced as open
# source for 2026-10-20. From that date, asks Hugging Face once a day and sends one ntfy push when it appears.
# Installed by: (crontab -l; echo "0 9 * * * <repo>/scripts/watch-fasth3-omni.sh >> <repo>/data/run/watch.log 2>&1") | crontab -
set -euo pipefail
cd "$(dirname "$0")/.."
SEEN=data/run/fasth3-omni.seen
DRY=${WATCH_DRY_RUN:-}                         # 1 = search now, print, never notify or record
[ -z "$DRY" ] && [ -f "$SEEN" ] && exit 0      # already announced
[ -z "$DRY" ] && [ "$(date +%Y%m%d)" -lt 20261020 ] && exit 0   # not before the announced date
found=""
for query in "author=FastVideo&search=Omni" "search=FastH3-Omni" "search=H3-Omni"; do
  found+=$(curl -s -m 30 "https://huggingface.co/api/models?${query}&limit=20" | python3 -c '
import json, sys
try:
    models = json.load(sys.stdin)
except Exception:
    sys.exit(0)
import re
# the release itself: "FastH3-Omni" in the id, or a FastVideo repo naming both H3 and Omni
# (plain FastH3 checkpoints, FastVideo's LTX OmniNFT LoRAs and others' "H3 ... Omni" tools already exist)
def is_release(model_id):
    lower = model_id.lower()
    return re.search(r"fast-?h3[-_ .]?omni", lower) or (lower.startswith("fastvideo/") and "omni" in lower and "h3" in lower)
print(" ".join(m["id"] for m in models if is_release(m["id"])), end=" ")
' || true)
done
found=$(echo "$found" | xargs -n1 2>/dev/null | sort -u | xargs || true)
echo "$(date -Iseconds) ${found:-nothing yet}"
[ -z "$found" ] || [ -n "$DRY" ] && exit 0
mkdir -p data/run
echo "$(date -Iseconds) $found" > "$SEEN"
url=$(npx --no-install tsx scripts/config-get.ts ntfyUrl 2>/dev/null || true)
[ -n "$url" ] && curl -s -m 10 -H "Title: FastH3-Omni is on Hugging Face" -H "Tags: tada" \
  -d "Found: $found. Sosie can try it as an opt-in engine profile; the default stays H3 until you say so." "$url" >/dev/null || true
