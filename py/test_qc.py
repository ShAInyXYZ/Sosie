"""Synthetic checks for the lip-sync scoring (run: py/.venv/bin/python py/test_qc.py)."""
import numpy as np
import qc

rng = np.random.default_rng(1)
n, fps = 240, 24
words, env = [], np.zeros(n)
t = 0.3
while t < 9.5:  # words of 0.3 s with 0.25 s gaps, and a long pause in the middle
    if 4.0 < t < 5.0:
        t = 5.0
    words.append({"word": "w", "start": t, "end": t + 0.3})
    env[int(t * fps):int((t + 0.3) * fps)] = 1 + 0.3 * rng.random()
    t += 0.55
synced = 0.02 + 0.05 * qc.smooth(np.convolve(env, np.ones(2) / 2, mode="same")) + 0.003 * rng.random(n)
late = np.roll(synced, 11)  # mouth one word period behind the voice

good = qc.sync_score(synced, env, words)
bad = qc.sync_score(late, env, words)
assert good["pass"], good
assert not bad["pass"], bad
assert qc.sync_score(synced, env, None)["envelope"]["pass"]
print("ok", good["envelope"]["margin"], good["pauses"]["nearRatio"], "| late:", bad["pauses"])
