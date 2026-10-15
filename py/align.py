#!/usr/bin/env python3
"""When each word is said: faster-whisper (base, CPU) hears the track with word timestamps, then its words are
matched back to the script's own words, so captions follow the voice exactly.
(the key is "word" instead of "w", to match Sosie's bundle).

    py/.venv/bin/python py/align.py <request.json>

request.json: {"model": "<faster-whisper model dir>", "wav": "<track>", "text": "<what was said>",
               "out": "<words.json>", "language": "en"}
    → [{"word": "It's", "start": 0.12, "end": 0.31}, …]  one entry per word of the text, in seconds
"""
import difflib
import json
import re
import sys
from pathlib import Path


def norm(word: str) -> str:
    return re.sub(r"[^a-z0-9$%]", "", word.lower().replace("’", "'"))


def match(words: list[str], heard: list[tuple[str, float, float]], duration: float) -> list[dict]:
    """Script words get the times of the heard words they match; the rest are spread between neighbours."""
    a, b = [norm(w) for w in words], [norm(h[0]) for h in heard]
    times: list = [None] * len(words)
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if op in ("equal", "replace") and j2 > j1:
            s0, s1 = heard[j1][1], heard[j2 - 1][2]
            n = i2 - i1
            for k in range(n):
                if op == "replace" or n != j2 - j1:
                    times[i1 + k] = (s0 + (s1 - s0) * k / n, s0 + (s1 - s0) * (k + 1) / n)
                else:
                    times[i1 + k] = (heard[j1 + k][1], heard[j1 + k][2])
    for i, t in enumerate(times):
        if t is None:
            prev = next((times[k][1] for k in range(i - 1, -1, -1) if times[k]), 0.0)
            nxt_i = next((k for k in range(i + 1, len(times)) if times[k]), None)
            nxt = times[nxt_i][0] if nxt_i is not None else duration
            gap = [k for k in range(i, nxt_i if nxt_i is not None else len(times)) if times[k] is None]
            step = (nxt - prev) / (len(gap) or 1)
            for j, k in enumerate(gap):
                times[k] = (prev + step * j, prev + step * (j + 1))
    return [{"word": w, "start": round(max(0.0, s), 3), "end": round(max(s, e), 3)} for w, (s, e) in zip(words, times)]


def align(req: dict) -> list[dict]:
    from faster_whisper import WhisperModel
    model = WhisperModel(req["model"], device="cpu", compute_type="int8", cpu_threads=4, local_files_only=True)
    segments, info = model.transcribe(req["wav"], language=req.get("language", "en"), word_timestamps=True,
                                      initial_prompt=req["text"], vad_filter=False)
    heard = [(w.word.strip(), w.start, w.end) for s in segments for w in (s.words or [])]
    return match(req["text"].split(), heard, info.duration)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    request = json.loads(Path(sys.argv[1]).read_text())
    words = align(request)
    Path(request["out"]).write_text(json.dumps(words, indent=0))
    print(json.dumps({"words": len(words)}))
