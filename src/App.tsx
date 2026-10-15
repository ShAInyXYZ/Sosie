import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type Face, type FormatId, type Job, type Lamp, type Look, type Settings, type SystemStatus, type Voice } from './api'
import { etaSeconds, formatEta, SECONDS_PER_TAKE, Stage } from './stage'
import { KitIcon } from './ui/icons'
import { FaceWindow, LibraryWindow, LookWindow, ScriptWindow, SettingsWindow, VoiceWindow } from './windows'

type Format = { id: FormatId; label: string; size: string }

const FORMATS: Format[] = [
  { id: 'corner', label: 'Corner', size: '768 × 768' },
  { id: 'reel', label: 'Reel', size: '576 × 1024' },
  { id: 'wide', label: 'Wide', size: '1024 × 576' },
]

type SlotId = 'face' | 'voice' | 'script' | 'look'
type Open = SlotId | 'library' | 'system' | 'settings' | null

const LAMP_TONE: Record<Lamp, string> = { ok: 'ok', down: 'crit', missing: 'idle' }
const LAMP_TEXT: Record<Lamp, string> = { ok: 'Running', down: 'Stopped', missing: 'Not installed' }

/** Per-viewer conveniences only (theme, last choices, last video); everything real lives in the API. */
function remembered<T extends string>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(`sosie-${key}`) as T | null) ?? fallback
    } catch {
      return fallback
    }
  })
  const set = (next: T) => {
    setValue(next)
    try {
      localStorage.setItem(`sosie-${key}`, next)
    } catch { /* private mode: kept for this visit */ }
  }
  return [value, set]
}

function useTheme() {
  const [theme, setTheme] = remembered<'dark' | 'light'>('theme', document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  return [theme, setTheme] as const
}

function SystemDialog({ status, onClose, onRefresh }: { status: SystemStatus | null; onClose: () => void; onRefresh: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [advanced, setAdvanced] = useState(false)
  const [note, setNote] = useState('')
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  const services: [keyof SystemStatus['services'], string][] = [
    ['api', 'Sosie API'],
    ['comfy', 'Sosie ComfyUI'],
    ['python', 'Python tools'],
  ]
  const comfyDown = status?.services.comfy === 'down'
  return (
    <dialog className="nk-dialog system-dialog" ref={dialog} onClose={onClose} aria-labelledby="system-title">
      <div className="nk-dialog-head">
        <h2 className="nk-dialog-title" id="system-title">System</h2>
        <button className="nk-icon-button is-ghost nk-dialog-close" aria-label="Close" onClick={() => dialog.current?.close()}>
          <KitIcon name="x" />
        </button>
      </div>
      <div className="nk-dialog-body">
        {services.map(([key, label]) => {
          const lamp = status?.services[key] ?? 'missing'
          return (
            <div className="nk-row has-led" key={key}>
              <span className="nk-led" data-tone={LAMP_TONE[lamp]} />
              <span className="nk-row-name">{label}</span>
              <span className="nk-row-value">{status ? LAMP_TEXT[lamp] : '—'}</span>
            </div>
          )
        })}
        {status?.problems.map((problem) => (
          <div className="nk-row has-led" data-tone="warn" key={problem.key}>
            <span className="nk-led" data-tone="warn" />
            <span className="nk-row-text">
              <span className="nk-row-name">{problem.key}</span>
              <span className="nk-row-sub">{problem.message}</span>
            </span>
          </div>
        ))}
        <div className="window-row">
          <button
            className="nk-button"
            disabled={!comfyDown}
            data-tooltip={comfyDown ? 'Starts Sosie’s ComfyUI (about a minute)' : 'Everything that is installed is running'}
            onClick={() => { void fetch('/api/system/start', { method: 'POST' }).then(() => { setNote('Starting…'); setTimeout(onRefresh, 5000) }) }}
          >
            Start services
          </button>
          {note ? <span className="dim">{note}</span> : null}
        </div>
        <label className="advanced-toggle">
          <button className="nk-switch" role="switch" aria-checked={advanced} aria-label="Advanced" onClick={() => setAdvanced(!advanced)}>
            <span className="nk-switch-thumb" />
          </button>
          <span>Advanced</span>
        </label>
        {advanced && (
          <div className="gpu-list">
            {status?.gpus === null && <p className="dim">GPU readings unavailable (nvidia-smi didn't answer).</p>}
            {status?.gpus?.map((gpu) => (
              <div className="nk-row gpu-row" key={gpu.index}>
                <span className="nk-row-name mono">GPU {gpu.index}</span>
                <span className="nk-row-sub">{gpu.name}</span>
                <div className="nk-progress" style={{ ['--v' as string]: Math.round((gpu.usedMb / gpu.totalMb) * 100) }} data-value={Math.round((gpu.usedMb / gpu.totalMb) * 100)} />
                <span className="nk-row-value mono">{(gpu.freeMb / 1024).toFixed(1)} GB free</span>
              </div>
            ))}
            <button
              className="nk-button is-sm"
              data-tooltip="Asks the main ComfyUI to unload its models; nothing else changes"
              onClick={() => { void fetch('/api/system/free-main', { method: 'POST' }).then((r) => setNote(r.ok ? 'Main ComfyUI VRAM freed' : 'The main ComfyUI did not answer')).then(() => setTimeout(onRefresh, 1500)) }}
            >
              Free main ComfyUI VRAM
            </button>
          </div>
        )}
      </div>
    </dialog>
  )
}

export default function App() {
  const [theme, setTheme] = useTheme()
  const [format, setFormat] = remembered<FormatId>('format', 'corner')
  const [faceId, setFaceId] = remembered<string>('face', '')
  const [voiceId, setVoiceId] = remembered<string>('voice', '')
  const [look, setLook] = remembered<string>('look', 'home-office')
  const [script, setScript] = remembered<string>('script', '')
  const [jobId, setJobId] = remembered<string>('job', '')
  // a link like /?video=<id> opens that video (from the CLI, the Library or a bookmark)
  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get('video')
    if (linked && /^[A-Za-z0-9-]{1,64}$/.test(linked)) setJobId(linked)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [settingsText, setSettingsText] = remembered<string>('settings', '{}')
  const settings = useMemo<Settings>(() => {
    try {
      return JSON.parse(settingsText) as Settings
    } catch {
      return {}
    }
  }, [settingsText])
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [faces, setFaces] = useState<Face[]>([])
  const [voices, setVoices] = useState<Voice[]>([])
  const [looks, setLooks] = useState<Look[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [open, setOpen] = useState<Open>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refreshSystem = useCallback(() => {
    api.system().then(setStatus, () => setStatus(null))
  }, [])
  const refreshLibrary = useCallback(() => {
    void api.faces().then(setFaces).catch(() => undefined)
    void api.voices().then(setVoices).catch(() => undefined)
    void api.jobs().then(setJobs).catch(() => undefined)
  }, [])
  useEffect(() => {
    refreshSystem()
    refreshLibrary()
    void api.looks().then(setLooks).catch(() => undefined)
    const timer = setInterval(refreshSystem, 10_000)
    return () => clearInterval(timer)
  }, [refreshSystem, refreshLibrary])

  // the default voice: Me once imported, otherwise the first designed one
  useEffect(() => {
    if (voices.length && !voices.some((voice) => voice.id === voiceId)) {
      setVoiceId((voices.find((voice) => voice.kind === 'clone') ?? voices[0]).id)
    }
  }, [voices]) // eslint-disable-line react-hooks/exhaustive-deps

  // follow the current video while it renders
  useEffect(() => {
    if (!jobId) {
      setJob(null)
      return
    }
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const poll = () => {
      api.job(jobId).then((next) => {
        if (!alive) return
        setJob(next)
        if (next.status === 'queued' || next.status === 'running') timer = setTimeout(poll, 1500)
        else refreshLibrary()
      }, () => { if (alive) setJob(null) })
    }
    poll()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [jobId, refreshLibrary])

  const face = faces.find((item) => item.id === faceId) ?? null
  const voice = voices.find((item) => item.id === voiceId) ?? null
  const lines = script.split('\n').filter((line) => line.trim()).length
  const words = script.split(/\s+/).filter(Boolean).length
  const busy = !!job && (job.status === 'queued' || job.status === 'running')
  const reason = !face ? 'Add a face first' : !script.trim() ? 'Write the script first' : !voice ? 'Add a voice first' : busy ? 'A video is rendering' : ''
  const estimate = useMemo(() => Math.ceil((words / 2.5) / 8) * SECONDS_PER_TAKE, [words])
  const eta = etaSeconds(busy ? job : null, estimate)

  const start = (firstSegmentOnly: boolean) => {
    setError('')
    api.startJob({ ...settings, script, faceId, voiceId, format, firstSegmentOnly }).then((next) => {
      setJobId(next.spec.id)
      setJob(next)
    }, (cause: Error) => setError(cause.message))
  }

  const slots: { id: SlotId; title: string; icon: string; state: string; hint: string; thumb?: string }[] = [
    { id: 'face', title: 'Face', icon: 'scene-camera', state: face?.name ?? 'No face yet', hint: face ? `${face.kind === 'photo' ? 'Photo' : 'Character'} · ${face.set.split(',')[0]}` : 'A photo, or a character made here', thumb: face ? api.keyFrameUrl(face.id) : undefined },
    { id: 'voice', title: 'Voice', icon: 'mic', state: voice?.name ?? 'No voice yet', hint: voice?.description ?? 'Your cloned voice or a designed one' },
    { id: 'script', title: 'Script', icon: 'edit', state: lines ? `${lines} line${lines === 1 ? '' : 's'} · ~${Math.round(words / 2.5)} s` : 'No script yet', hint: script.split('\n')[0] || 'Type it, or let AI write it from your context' },
    { id: 'look', title: 'Look', icon: 'scene-environment', state: looks.find((item) => item.id === look)?.name ?? 'Home office', hint: 'The set behind a photo or a new character' },
  ]

  return (
    <div className="studio">
      <header className="studio-bar">
        <div className="nk-wordmark">Sosie</div>
        <div className="studio-bar-end">
          <button className="nk-button is-sm is-ghost" data-tooltip="Faces, voices and videos" onClick={() => setOpen('library')}>
            <KitIcon name="folder" />
            <span>Library</span>
          </button>
          <button className="nk-button is-sm is-ghost system-button" data-tooltip="Services and GPUs" onClick={() => setOpen('system')}>
            {(['api', 'comfy', 'python'] as const).map((key) => (
              <span className="nk-led" key={key} data-tone={status ? LAMP_TONE[status.services[key]] : 'idle'} />
            ))}
            <span>System</span>
          </button>
          <div className="theme-control">
            <span>Light</span>
            <button className="nk-switch" role="switch" aria-label="Light theme" aria-checked={theme === 'light'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
              <span className="nk-switch-thumb" />
            </button>
          </div>
        </div>
      </header>

      <main className="studio-main">
        <section className="nk-panel studio-inputs" aria-label="Inputs">
          {slots.map((slot) => (
            <button key={slot.id} className="studio-slot" data-tooltip={slot.hint} disabled={busy} onClick={() => setOpen(slot.id)} aria-describedby={`${slot.id}-state`}>
              <span className="studio-slot-well" aria-hidden="true">
                {slot.thumb ? <img src={slot.thumb} alt="" draggable={false} /> : <KitIcon name={slot.icon} size={22} />}
              </span>
              <span className="studio-slot-title">{slot.title}</span>
              <span className="studio-slot-state" id={`${slot.id}-state`}>{slot.state}</span>
            </button>
          ))}
        </section>

        <section className="studio-stage" aria-label="Preview">
          <Stage
            format={job?.status === 'done' ? job.spec.format : format}
            face={face}
            job={job}
            onCancel={() => { void api.cancelJob(jobId).then(setJob) }}
            onResume={() => { void api.resume(jobId).then(setJob) }}
            onReroll={(segment) => { void api.reroll(jobId, segment).then(setJob, (cause: Error) => setError(cause.message)) }}
            onSend={async () => {
              const result = await api.send(jobId)
              return result.sent ? `Sent. Open ${result.folderPath} in MOceanX.` : `${result.reason} Bundle: ${result.bundle}`
            }}
          />
          {error ? <p className="nk-field-error" role="alert">{error}</p> : null}
          {notice ? <p className="dim" role="status">{notice}</p> : null}
        </section>
      </main>

      <footer className="studio-actions">
        <div className="nk-segmented" role="tablist" aria-label="Format">
          {FORMATS.map((item) => (
            <button key={item.id} className="nk-segmented-btn" role="tab" aria-selected={format === item.id} data-tooltip={item.size} disabled={busy} onClick={() => setFormat(item.id)}>
              <span className="nk-segmented-label">{item.label}</span>
            </button>
          ))}
        </div>
        {job && !busy ? <button className="nk-button is-ghost" onClick={() => setJobId('')}>New video</button> : null}
        <button className="nk-icon-button is-ghost" aria-label="Settings" data-tooltip="Voice, speed, punch-in and advanced settings" disabled={busy} onClick={() => setOpen('settings')}>
          <KitIcon name="settings" />
        </button>
        <span className="studio-eta mono" data-tooltip="Estimated render time">ETA {formatEta(eta)}</span>
        <button className="nk-button" disabled={!!reason} data-tooltip={reason || 'Voice the script, film segment 1 only'} onClick={() => start(true)}>
          Try first segment
        </button>
        <button className="nk-button is-primary" disabled={!!reason} data-tooltip={reason || 'Render the whole video'} onClick={() => start(false)}>
          <KitIcon name="scene-render" />
          <span>Generate</span>
        </button>
        {reason ? <span className="studio-reason dim">{reason}</span> : null}
      </footer>

      {open === 'face' && (
        <FaceWindow
          faces={faces} chosen={faceId} looks={looks} look={look} format={format}
          onChoose={(id) => { setFaceId(id); setOpen(null) }}
          onCreated={(created) => { setFaceId(created.id); setNotice(created.warnings?.join(' ') ?? ''); refreshLibrary(); setOpen(null) }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'voice' && (
        <VoiceWindow
          voices={voices} chosen={voiceId}
          onChoose={(id) => { setVoiceId(id); setOpen(null) }}
          onCreated={(created) => { setVoiceId(created.id); refreshLibrary(); setOpen(null) }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'script' && <ScriptWindow script={script} engine={settings.voiceEngine} onChange={setScript} onClose={() => setOpen(null)} />}
      {open === 'look' && <LookWindow looks={looks} chosen={look} onChoose={(id) => { setLook(id); setOpen(null) }} onClose={() => setOpen(null)} />}
      {open === 'library' && (
        <LibraryWindow
          faces={faces} voices={voices} jobs={jobs}
          onOpenJob={(id) => { setJobId(id); setOpen(null) }}
          onChanged={refreshLibrary}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'settings' && <SettingsWindow settings={settings} dots={status ? status.dots ?? null : undefined} onChange={(next) => setSettingsText(JSON.stringify(next))} onClose={() => setOpen(null)} />}
      {open === 'system' && <SystemDialog status={status} onClose={() => setOpen(null)} onRefresh={refreshSystem} />}
    </div>
  )
}
