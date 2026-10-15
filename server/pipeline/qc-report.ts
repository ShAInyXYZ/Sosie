import type { JobState } from './job.ts'

type Lip = { offset?: number; confidence?: number; minDist?: number; status?: string; pass?: boolean }

const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** The per-video QC page: one row per segment, the chosen take's measures and verdict. Self-contained HTML. */
export function qcReportHtml(state: JobState): string {
  const rows = state.segments.map((segment) => {
    const take = segment.attempts.find((a) => a.file === segment.file) ?? segment.attempts.at(-1)
    const lip = (take?.qc.lipSync ?? {}) as Lip
    const face = (take?.qc.face ?? {}) as { ratio?: number }
    const clean = (take?.qc.clean ?? {}) as { ok?: boolean }
    const offsetMs = lip.offset === undefined ? '—' : `${lip.offset * 40 > 0 ? '+' : ''}${lip.offset * 40} ms`
    const verdict = segment.status === 'done' ? 'pass' : segment.status === 'flagged' ? 'needs a look' : 'pending'
    return `<tr class="${segment.status}">
      <td>${segment.index + 1}</td>
      <td>${segment.startS.toFixed(2)}–${(segment.startS + segment.durationS).toFixed(2)} s</td>
      <td>${segment.attempts.length}</td>
      <td>${offsetMs}</td>
      <td>${lip.confidence?.toFixed(2) ?? esc(lip.status ?? '—')}</td>
      <td>${lip.minDist?.toFixed(2) ?? '—'}</td>
      <td>${face.ratio === undefined ? '—' : `${Math.round(face.ratio * 100)} %`}</td>
      <td>${clean.ok === undefined ? '—' : clean.ok ? 'clean' : 'artefacts'}</td>
      <td><span class="lamp"></span>${verdict}</td>
      <td class="text">${esc(segment.text)}</td>
    </tr>`
  }).join('\n')
  const passed = state.segments.filter((s) => s.status === 'done').length
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QC · ${esc(state.spec.name)}</title>
<style>
  :root { --bg: #f4f3ef; --text: #1b1c1e; --dim: #6b6d72; --line: #d9d7d0; --ok: #2f9e5b; --warn: #d08a1a; --idle: #9a9ca1; }
  @media (prefers-color-scheme: dark) { :root { --bg: #151618; --text: #e8e7e3; --dim: #8d8f94; --line: #2b2d31; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 1800px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p { color: var(--dim); margin: 0 0 20px; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { color: var(--dim); font-weight: 600; font-size: 13px; }
  td.text { white-space: normal; min-width: 320px; color: var(--dim); }
  .lamp { display: inline-block; width: 8px; height: 8px; margin-right: 8px; background: var(--idle); }
  tr.done .lamp { background: var(--ok); }
  tr.flagged .lamp { background: var(--warn); }
</style>
</head>
<body>
<main>
  <h1>${esc(state.spec.name)}</h1>
  <p>${passed} of ${state.segments.length} segments pass · lip sync by SyncNet: offset (negative = the voice comes after the lips; pass from −120 to +40 ms), LSE-C confidence (pass ≥ 6), LSE-D distance (pass ≤ 9) · ${esc(state.updatedAt)}</p>
  <div class="scroll">
  <table>
    <thead><tr><th>#</th><th>Time</th><th>Takes</th><th>Offset</th><th>LSE-C</th><th>LSE-D</th><th>Face</th><th>Frames</th><th>Verdict</th><th>Line</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  </div>
</main>
</body>
</html>
`
}
