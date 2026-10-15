import { useState } from 'react'
import { api, type Face, type FormatId, type Job, type Segment } from './api'
import { KitIcon } from './ui/icons'
import { ZoomImage } from './zoom'

/** Seconds of filming per segment take, measured on the rig (§3.4); refined by the job's own timings. */
export const SECONDS_PER_TAKE = 240

export function etaSeconds(job: Job | null, estimate: number): number {
  if (!job) return estimate
  if (job.status === 'done' || job.status === 'failed' || job.status === 'canceled') return 0
  const left = job.segments.filter((segment) => segment.status === 'pending').length
  const takes = job.segments.flatMap((segment) => segment.attempts)
  const perTake = takes.length ? takes.reduce((sum, take) => sum + take.seconds, 0) / takes.length : SECONDS_PER_TAKE
  return Math.round((job.segments.length ? left : Math.max(1, Math.ceil(estimate / SECONDS_PER_TAKE))) * perTake + 20)
}

export function formatEta(seconds: number): string {
  if (seconds <= 0) return '—'
  return seconds < 90 ? `~${seconds} s` : `~${Math.round(seconds / 60)} min`
}

const LAMP: Record<Segment['status'], string> = { pending: 'idle', done: 'ok', flagged: 'warn' }

function qcLine(segment: Segment): string {
  const take = segment.attempts.at(-1)
  const margin = take?.qc.lipSync?.envelope?.margin
  const status = segment.status === 'done' ? 'Lip sync OK' : segment.status === 'flagged' ? 'Lip sync needs a look' : 'Waiting'
  return `Segment ${segment.index + 1} · ${segment.durationS.toFixed(1)} s · ${status}${margin !== undefined ? ` (score ${margin.toFixed(2)})` : ''} · ${segment.attempts.length} take${segment.attempts.length === 1 ? '' : 's'}`
}

function SegmentStrip({ job, current, onReroll }: { job: Job; current: number; onReroll?: (segment: number) => void }) {
  const total = job.segments.reduce((sum, segment) => sum + segment.durationS, 0) || 1
  return (
    <div className="segment-strip" aria-label="Segments">
      {job.segments.map((segment) => (
        <div
          key={segment.index}
          className={`segment ${segment.index === current ? 'is-current' : ''}`}
          style={{ flexGrow: segment.durationS / total }}
          data-tooltip={qcLine(segment)}
        >
          <span className="nk-led" data-tone={segment.index === current ? 'info' : LAMP[segment.status]} />
          <span className="mono">{segment.index + 1}</span>
          {onReroll && segment.status !== 'pending' ? (
            <button className="nk-icon-button is-ghost is-sm" aria-label={`Re-roll segment ${segment.index + 1}`} data-tooltip="Film this segment again" onClick={() => onReroll(segment.index + 1)}>
              <KitIcon name="refresh" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export function Stage({ format, face, job, onCancel, onReroll, onResume, onSend }: {
  format: FormatId
  face: Face | null
  job: Job | null
  onCancel: () => void
  onReroll: (segment: number) => void
  onResume: () => void
  onSend: () => Promise<string>
}) {
  const [sent, setSent] = useState('')
  const active = job && (job.status === 'queued' || job.status === 'running')
  const current = job?.segments.findIndex((segment) => segment.status === 'pending') ?? -1

  if (job?.status === 'done' && job.outputs) {
    return (
      <div className="stage-result">
        <div className={`studio-frame is-${job.spec.format}`}>
          <video key={job.spec.id + job.createdAt} className="result-video" src={api.fileUrl(job.spec.id, 'facecam.mp4')} controls playsInline />
        </div>
        <SegmentStrip job={job} current={-1} onReroll={onReroll} />
        <div className="result-actions">
          <a className="nk-button is-primary" href={api.fileUrl(job.spec.id, 'facecam.mp4')} download={`${job.spec.name}.mp4`}>
            <KitIcon name="download" /> <span>Download MP4</span>
          </a>
          <a className="nk-button" href={api.fileUrl(job.spec.id, 'captions.srt')} download={`${job.spec.name}.srt`}>Captions</a>
          <button className="nk-button" onClick={() => void onSend().then(setSent, (error: Error) => setSent(error.message))}>Send to MOceanX</button>
          {job.message.includes('need a look') ? <span className="result-note" role="status"><span className="nk-led" data-tone="warn" /> Some segments need a look</span> : null}
        </div>
        {sent ? <p className="dim" role="status">{sent}</p> : null}
      </div>
    )
  }

  return (
    <div className="stage-preview">
      <div className={`studio-frame is-${format}`}>
        {face ? <ZoomImage src={api.keyFrameUrl(face.id)} alt={face.name} className="frame-image" /> : <div className="nk-empty">Your facecam appears here</div>}
        {active ? (
          <div className="stage-progress" role="status" aria-live="polite">
            <div className="nk-progress" style={{ ['--v' as string]: Math.round(job.progress * 100) }} data-value={Math.round(job.progress * 100)} />
            <span>{job.message}</span>
          </div>
        ) : null}
      </div>
      {job && job.segments.length && job.status !== 'done' ? <SegmentStrip job={job} current={active ? current : -1} /> : null}
      {active ? <button className="nk-button" onClick={onCancel}>Cancel</button> : null}
      {job && (job.status === 'failed' || job.status === 'canceled') ? (
        <div className="result-actions">
          <span className="nk-field-error" role="alert">{job.status === 'failed' ? job.error ?? job.message : 'Canceled'}</span>
          <button className="nk-button" onClick={onResume}>Continue</button>
        </div>
      ) : null}
    </div>
  )
}
