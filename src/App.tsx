import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Lamp, type SystemStatus } from './api'
import { KitIcon } from './ui/icons'

type Format = { id: 'corner' | 'reel' | 'wide'; label: string; size: string }

const FORMATS: Format[] = [
  { id: 'corner', label: 'Corner', size: '640 × 640' },
  { id: 'reel', label: 'Reel', size: '576 × 1024' },
  { id: 'wide', label: 'Wide', size: '1024 × 576' },
]

type Slot = { id: 'face' | 'voice' | 'script' | 'look'; title: string; icon: string; empty: string; hint: string }

const SLOTS: Slot[] = [
  { id: 'face', title: 'Face', icon: 'scene-camera', empty: 'No face yet', hint: 'A photo, or a character made here' },
  { id: 'voice', title: 'Voice', icon: 'mic', empty: 'No voice yet', hint: 'Your cloned voice or a designed one' },
  { id: 'script', title: 'Script', icon: 'edit', empty: 'No script yet', hint: 'Type it, or let AI write it from your context' },
  { id: 'look', title: 'Look', icon: 'scene-environment', empty: 'Home office', hint: 'The set behind the person' },
]

const LAMP_TONE: Record<Lamp, string> = { ok: 'ok', down: 'crit', missing: 'idle' }
const LAMP_TEXT: Record<Lamp, string> = { ok: 'Running', down: 'Stopped', missing: 'Not installed' }

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  )
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('sosie-theme', theme)
    } catch {
      /* private mode: the theme still applies for this visit */
    }
  }, [theme])
  return [theme, setTheme] as const
}

function SystemDialog({ status, onClose }: { status: SystemStatus | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [advanced, setAdvanced] = useState(false)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  const services: [keyof SystemStatus['services'], string][] = [
    ['api', 'Sosie API'],
    ['comfy', 'Sosie ComfyUI'],
    ['python', 'Python tools'],
  ]
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
              <div className="nk-row" key={gpu.index}>
                <span className="nk-row-name mono">GPU {gpu.index}</span>
                <span className="nk-row-sub">{gpu.name}</span>
                <span className="nk-row-value mono">
                  {(gpu.freeMb / 1024).toFixed(1)} / {(gpu.totalMb / 1024).toFixed(1)} GB free
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </dialog>
  )
}

export default function App() {
  const [theme, setTheme] = useTheme()
  const [format, setFormat] = useState<Format['id']>('corner')
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [systemOpen, setSystemOpen] = useState(false)

  const refresh = useCallback(() => {
    api.system().then(setStatus, () => setStatus(null))
  }, [])
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 10_000)
    return () => clearInterval(timer)
  }, [refresh])

  const ready = false // a face and a script are required; both arrive with their editors
  const reason = 'Add a face and a script first'

  return (
    <div className="studio">
      <header className="studio-bar">
        <div className="nk-wordmark">Sosie</div>
        <div className="studio-bar-end">
          <button
            className="nk-button is-sm is-ghost system-button"
            data-tooltip="Services and GPUs"
            onClick={() => setSystemOpen(true)}
          >
            {(['api', 'comfy', 'python'] as const).map((key) => (
              <span className="nk-led" key={key} data-tone={status ? LAMP_TONE[status.services[key]] : 'idle'} />
            ))}
            <span>System</span>
          </button>
          <div className="theme-control">
            <span>Light</span>
            <button
              className="nk-switch"
              role="switch"
              aria-label="Light theme"
              aria-checked={theme === 'light'}
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            >
              <span className="nk-switch-thumb" />
            </button>
          </div>
        </div>
      </header>

      <main className="studio-main">
        <section className="nk-panel studio-inputs" aria-label="Inputs">
          {SLOTS.map((slot) => (
            <button key={slot.id} className="studio-slot" data-tooltip={slot.hint} disabled aria-describedby={`${slot.id}-state`}>
              <span className="studio-slot-well" aria-hidden="true">
                <KitIcon name={slot.icon} size={22} />
              </span>
              <span className="studio-slot-title">{slot.title}</span>
              <span className="studio-slot-state" id={`${slot.id}-state`}>{slot.empty}</span>
            </button>
          ))}
        </section>

        <section className="studio-stage" aria-label="Preview">
          <div className={`studio-frame is-${format}`}>
            <div className="nk-empty">Your facecam appears here</div>
          </div>
        </section>
      </main>

      <footer className="studio-actions">
        <div className="nk-segmented" role="tablist" aria-label="Format">
          {FORMATS.map((item) => (
            <button
              key={item.id}
              className="nk-segmented-btn"
              role="tab"
              aria-selected={format === item.id}
              data-tooltip={item.size}
              onClick={() => setFormat(item.id)}
            >
              <span className="nk-segmented-label">{item.label}</span>
            </button>
          ))}
        </div>
        <span className="studio-eta mono" data-tooltip="Estimated render time">ETA —</span>
        <button className="nk-button" disabled={!ready} data-tooltip={ready ? 'Render segment 1 only' : reason}>
          Try first segment
        </button>
        <button className="nk-button is-primary" disabled={!ready} data-tooltip={ready ? 'Render the whole video' : reason}>
          <KitIcon name="scene-render" />
          <span>Generate</span>
        </button>
      </footer>

      {systemOpen && <SystemDialog status={status} onClose={() => setSystemOpen(false)} />}
    </div>
  )
}
