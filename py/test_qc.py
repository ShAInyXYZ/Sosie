"""Checks for the lip-sync verdict (run: py/.venv/bin/python py/test_qc.py).

The scores are the measured ones from the first 60 s proof and its controls (docs/PROGRESS.md)."""
import qc

ok = lambda offset, dist, conf: qc.sync_verdict({"status": "ok", "offset": offset, "minDist": dist, "confidence": conf})["pass"]

assert ok(0, 7.435, 9.162)  # segment 1
assert ok(-1, 8.394, 8.1)  # the weakest real take (segment 7)
assert not ok(13, 15.789, 0.751)  # the voice played backwards
assert not ok(-9, 7.608, 9.257)  # the voice 8 frames late: confident, but out of time
assert not ok(-1, 11.09, 5.108)  # filmed without the audio anchor
assert not ok(2, 7.0, 9.0)  # the voice 80 ms early
assert ok(-3, 7.0, 9.0)  # the voice 120 ms late is still within tolerance
assert qc.sync_verdict({"status": "no face"})["pass"]  # the face check decides
print("ok")
