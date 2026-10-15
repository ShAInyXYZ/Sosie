import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type CharacterForm, type Face, type FormatId, type ImageLora, type Job, type Look, type Settings, type Voice } from './api'
import { NkSelect, NkSlider } from './ui/controls'
import { KitIcon } from './ui/icons'
import { ZoomImage } from './zoom'

/** A centred floating window: a simple view first, the rest behind an Advanced toggle. */
export function Window({ title, onClose, advanced, children, wide = false }: {
  title: string
  onClose: () => void
  advanced?: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return (
    <dialog
      className={`nk-dialog studio-window ${wide ? 'is-wide' : ''}`}
      ref={dialog}
      onClose={onClose}
      aria-label={title}
      onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close() }}
    >
      <div className="nk-dialog-head">
        <h2 className="nk-dialog-title">{title}</h2>
        <button className="nk-icon-button is-ghost nk-dialog-close" aria-label="Close" onClick={() => dialog.current?.close()}>
          <KitIcon name="x" />
        </button>
      </div>
      <div className="nk-dialog-body">
        {children}
        {advanced ? (
          <>
            <label className="advanced-toggle">
              <button className="nk-switch" role="switch" aria-checked={showAdvanced} aria-label="Advanced" onClick={() => setShowAdvanced(!showAdvanced)}>
                <span className="nk-switch-thumb" />
              </button>
              <span>Advanced</span>
            </label>
            {showAdvanced ? <div className="window-advanced">{advanced}</div> : null}
          </>
        ) : null}
      </div>
    </dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="nk-field">
      <span className="nk-field-label">{label}</span>
      {children}
    </label>
  )
}

function Busy({ text }: { text: string }) {
  return (
    <p className="window-busy" role="status">
      <span className="nk-spinner is-sm" /> {text}
    </p>
  )
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function FaceWindow({ faces, chosen, looks, look, format, onChoose, onCreated, onClose }: {
  faces: Face[]
  chosen: string | null
  looks: Look[]
  look: string
  format: FormatId
  onChoose: (id: string) => void
  onCreated: (face: Face) => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [who, setWho] = useState('')
  const [form, setForm] = useState<CharacterForm>({ who: '', style: 'photo' })
  const [candidates, setCandidates] = useState<string[]>([])
  const [pick, setPick] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [consent, setConsent] = useState(false)
  const photo = useRef<HTMLInputElement>(null)
  const lookName = looks.find((item) => item.id === look)?.name ?? 'Home office'
  const [loras, setLoras] = useState<{ file: string; steps: number }[]>([])
  const [lora, setLora] = useState<ImageLora | null>(null)
  useEffect(() => {
    api.imageLoras().then((result) => { setLoras(result.loras); setLora(result.default) }, () => undefined)
  }, [])

  const run = async (text: string, work: () => Promise<void>) => {
    setBusy(text)
    setError('')
    try {
      await work()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy('')
    }
  }
  const createOptions = () => run('Creating 4 options — about 3 minutes', async () => {
    setCandidates(await api.characters({ ...form, who }, look, format, lora))
    setPick(null)
  })
  const usePick = () => run('Saving', async () => {
    onCreated(await api.chooseCharacter(pick!, name || who || 'Character'))
  })
  const usePhoto = () => run(`Cutting out the photo and building the ${lookName.toLowerCase()} set`, async () => {
    const file = photo.current?.files?.[0]
    if (!file) throw new Error('Choose a photo.')
    const data = new FormData()
    data.append('photo', file)
    data.append('name', name || 'Me')
    data.append('look', look)
    data.append('format', format)
    data.append('consent', String(consent))
    onCreated(await api.photoFace(data))
  })

  return (
    <Window
      title="Face"
      wide
      onClose={onClose}
      advanced={(
        <div className="window-grid">
          <Field label="Age"><input value={form.age ?? ''} onChange={(event) => setForm({ ...form, age: event.target.value })} placeholder="early thirties" /></Field>
          <Field label="Hair"><input value={form.hair ?? ''} onChange={(event) => setForm({ ...form, hair: event.target.value })} placeholder="short curly black hair" /></Field>
          <Field label="Outfit"><input value={form.outfit ?? ''} onChange={(event) => setForm({ ...form, outfit: event.target.value })} placeholder="a grey hoodie" /></Field>
          <Field label="Style">
            <NkSelect value={form.style} onChange={(event) => setForm({ ...form, style: event.target.value as CharacterForm['style'] })}>
              <option value="photo">Photo-real</option>
              <option value="anime">Anime</option>
              <option value="3d">3D</option>
            </NkSelect>
          </Field>
          <Field label="LoRA">
            <NkSelect value={lora?.file ?? ''} onChange={(event) => setLora(event.target.value ? { file: event.target.value, strength: lora?.strength ?? 1 } : null)}>
              <option value="">None · 30 steps</option>
              {loras.map((item) => <option key={item.file} value={item.file}>{item.file.replace(/\.safetensors$/, '')} · {item.steps} steps</option>)}
            </NkSelect>
          </Field>
          {lora ? (
            <Field label={`Strength ${lora.strength.toFixed(2)}`}>
              <NkSlider min={0} max={2} step={0.05} value={lora.strength} onChange={(event) => setLora({ ...lora, strength: Number(event.target.value) })} />
            </Field>
          ) : null}
        </div>
      )}
    >
      {faces.length ? (
        <div className="face-grid" role="listbox" aria-label="Faces">
          {faces.map((face) => (
            <button
              key={face.id}
              role="option"
              aria-selected={face.id === chosen}
              className="face-option"
              data-tooltip={`${face.kind === 'photo' ? 'Photo' : 'Character'} · ${face.set.split(',')[0]}`}
              onClick={() => onChoose(face.id)}
            >
              <img src={api.keyFrameUrl(face.id)} alt="" draggable={false} />
              <span>{face.name}</span>
            </button>
          ))}
        </div>
      ) : <p className="dim">No faces yet. Create a character or use a photo.</p>}

      <div className="window-section">
        <h3>New character</h3>
        <div className="window-row">
          <input className="window-input" aria-label="Who is on camera" value={who} onChange={(event) => setWho(event.target.value)} placeholder="a friendly tech streamer" />
          <button className="nk-button" disabled={!who.trim() || !!busy} data-tooltip={`Four options in the ${lookName.toLowerCase()} look`} onClick={() => void createOptions()}>
            Create 4 options
          </button>
        </div>
        {candidates.length ? (
          <>
            <div className="candidate-grid" role="listbox" aria-label="Options">
              {candidates.map((candidate) => (
                <button key={candidate} role="option" aria-selected={pick === candidate} className="candidate" onClick={() => setPick(candidate)}>
                  <img src={api.candidateUrl(candidate)} alt="" draggable={false} />
                </button>
              ))}
            </div>
            {pick ? <ZoomImage src={api.candidateUrl(pick)} alt="Chosen option" className="candidate-zoom" /> : null}
            <div className="window-row">
              <input className="window-input" aria-label="Name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
              <button className="nk-button is-primary" disabled={!pick || !!busy} data-tooltip={pick ? 'Save this face' : 'Pick one option'} onClick={() => void usePick()}>
                Use this one
              </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="window-section">
        <h3>Your photo</h3>
        <div className="window-row">
          <input ref={photo} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Photo" />
          <label className="nk-checkbox">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            This is me, or I have this person's permission.
          </label>
          <button className="nk-button" disabled={!consent || !!busy} data-tooltip={consent ? 'Your face stays pixel-true; only the set is generated' : 'Confirm permission first'} onClick={() => void usePhoto()}>
            Use photo
          </button>
        </div>
      </div>
      {busy ? <Busy text={busy} /> : null}
      {error ? <p className="nk-field-error" role="alert">{error}</p> : null}
    </Window>
  )
}

export function VoiceWindow({ voices, chosen, onChoose, onCreated, onClose }: {
  voices: Voice[]
  chosen: string | null
  onChoose: (id: string) => void
  onCreated: (voice: Voice) => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [description, setDescription] = useState('')
  const [name, setName] = useState('')
  const [transcript, setTranscript] = useState('')
  const [consent, setConsent] = useState(false)
  const sample = useRef<HTMLInputElement>(null)
  const run = async (text: string, work: () => Promise<void>) => {
    setBusy(text)
    setError('')
    try {
      await work()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy('')
    }
  }
  return (
    <Window
      title="Voice"
      onClose={onClose}
      advanced={(
        <div className="window-section">
          <h3>Import my voice</h3>
          <input ref={sample} type="file" accept="audio/*" aria-label="Voice sample" />
          <Field label="Exactly what you say in the sample">
            <textarea rows={3} value={transcript} onChange={(event) => setTranscript(event.target.value)} />
          </Field>
          <label className="nk-checkbox">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            This is my voice, or I have permission to clone it.
          </label>
          <button
            className="nk-button"
            disabled={!consent || !transcript.trim() || !!busy}
            data-tooltip={consent ? '10–20 s of clean speech works best' : 'Confirm permission first'}
            onClick={() => void run('Importing', async () => {
              const file = sample.current?.files?.[0]
              if (!file) throw new Error('Choose a voice sample.')
              const data = new FormData()
              data.append('sample', file)
              data.append('name', name || 'Me')
              data.append('transcript', transcript)
              data.append('consent', String(consent))
              onCreated(await api.importVoice(data))
            })}
          >
            Import
          </button>
        </div>
      )}
    >
      {voices.length ? (
        <div className="choice-list" role="listbox" aria-label="Voices">
          {voices.map((voice) => (
            <button key={voice.id} role="option" aria-selected={voice.id === chosen} className="choice" data-tooltip={voice.description ?? 'Cloned from a sample'} onClick={() => onChoose(voice.id)}>
              <KitIcon name="mic" />
              <span>{voice.name}</span>
              <span className="dim">{voice.kind === 'clone' ? 'Cloned' : 'Designed'}</span>
            </button>
          ))}
        </div>
      ) : <p className="dim">No voices yet. Design one from a description.</p>}
      <div className="window-section">
        <h3>Design a voice</h3>
        <div className="window-row">
          <input className="window-input" aria-label="Voice name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
          <input className="window-input is-wide" aria-label="Describe the voice" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="a warm, calm woman in her forties" />
          <button className="nk-button" disabled={!description.trim() || !!busy} onClick={() => void run('Designing — about a minute', async () => onCreated(await api.designVoice(name, description)))}>
            Design
          </button>
        </div>
      </div>
      {busy ? <Busy text={busy} /> : null}
      {error ? <p className="nk-field-error" role="alert">{error}</p> : null}
    </Window>
  )
}

export function ScriptWindow({ script, onChange, onClose }: { script: string; onChange: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState(script)
  const [context, setContext] = useState('')
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const words = text.split(/\s+/).filter(Boolean).length
  return (
    <Window
      title="Script"
      wide
      onClose={() => { onChange(text); onClose() }}
      advanced={(
        <div className="window-section">
          <h3>Write with AI</h3>
          <Field label="Context (notes, an article, a README…)">
            <textarea rows={4} value={context} onChange={(event) => setContext(event.target.value)} />
          </Field>
          <div className="window-row">
            <input className="window-input is-wide" aria-label="What should it explain" value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Explain this in about a minute, upbeat" />
            <button
              className="nk-button"
              disabled={!brief.trim() || busy}
              data-tooltip="Uses your Claude Code or Codex sign-in on this machine"
              onClick={() => {
                setBusy(true)
                setError('')
                api.writeScript(context, brief).then((result) => setText(result.script), (cause) => setError(errorText(cause))).finally(() => setBusy(false))
              }}
            >
              Write
            </button>
          </div>
          {busy ? <Busy text="Writing" /> : null}
          {error ? <p className="nk-field-error" role="alert">{error}</p> : null}
        </div>
      )}
    >
      <textarea
        className="script-text"
        aria-label="Script"
        rows={12}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={'One sentence per line.\nAdd a delivery note at the end in brackets. [excited]'}
      />
      <p className="dim mono">{words} words · about {Math.max(1, Math.round(words / 2.5))} s</p>
    </Window>
  )
}

export function LookWindow({ looks, chosen, onChoose, onClose }: { looks: Look[]; chosen: string; onChoose: (id: string) => void; onClose: () => void }) {
  return (
    <Window title="Look" onClose={onClose}>
      <div className="choice-list" role="listbox" aria-label="Looks">
        {looks.map((look) => (
          <button key={look.id} role="option" aria-selected={look.id === chosen} className="choice" data-tooltip={look.prompt} onClick={() => onChoose(look.id)}>
            <KitIcon name="scene-environment" />
            <span>{look.name}</span>
          </button>
        ))}
      </div>
      <p className="dim">The look is the set behind a photo or a new character.</p>
    </Window>
  )
}

export function LibraryWindow({ faces, voices, jobs, onOpenJob, onChanged, onClose }: {
  faces: Face[]
  voices: Voice[]
  jobs: Job[]
  onOpenJob: (id: string) => void
  onChanged: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'videos' | 'faces' | 'voices'>('videos')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const match = (text: string) => text.toLowerCase().includes(query.trim().toLowerCase())
  const remove = async (kind: 'faces' | 'voices' | 'videos', id: string, name: string) => {
    if (!window.confirm(`Delete “${name}”? It moves to data/trash.`)) return
    try {
      await api.trash(kind, id)
      onChanged()
    } catch (cause) {
      setError(errorText(cause))
    }
  }
  const items = tab === 'videos'
    ? jobs.filter((job) => match(job.spec.name)).map((job) => ({ id: job.spec.id, name: job.spec.name, sub: `${job.status} · ${new Date(job.createdAt).toLocaleString()}` }))
    : tab === 'faces'
      ? faces.filter((face) => match(face.name)).map((face) => ({ id: face.id, name: face.name, sub: face.kind === 'photo' ? 'Photo' : 'Character' }))
      : voices.filter((voice) => match(voice.name)).map((voice) => ({ id: voice.id, name: voice.name, sub: voice.kind === 'clone' ? 'Cloned' : 'Designed' }))
  return (
    <Window title="Library" wide onClose={onClose}>
      <div className="window-row">
        <div className="nk-segmented" role="tablist" aria-label="Library">
          {(['videos', 'faces', 'voices'] as const).map((id) => (
            <button key={id} className="nk-segmented-btn" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              <span className="nk-segmented-label">{id[0].toUpperCase() + id.slice(1)}</span>
            </button>
          ))}
        </div>
        <input className="window-input is-wide" aria-label="Search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
      </div>
      <div className="library-list">
        {items.length ? items.map((item) => (
          <div className="nk-row" key={item.id}>
            {tab === 'videos' ? (
              <button className="nk-button is-sm is-ghost library-open" onClick={() => onOpenJob(item.id)}>{item.name}</button>
            ) : <span className="nk-row-name">{item.name}</span>}
            <span className="nk-row-sub">{item.sub}</span>
            <button className="nk-icon-button is-ghost" aria-label={`Delete ${item.name}`} data-tooltip="Delete" onClick={() => void remove(tab, item.id, item.name)}>
              <KitIcon name="trash" />
            </button>
          </div>
        )) : <p className="dim">Nothing here yet.</p>}
      </div>
      {error ? <p className="nk-field-error" role="alert">{error}</p> : null}
    </Window>
  )
}

export function SettingsWindow({ settings, onChange, onClose }: { settings: Settings; onChange: (next: Settings) => void; onClose: () => void }) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })
  const number = (value: string) => (value.trim() === '' ? undefined : Number(value))
  return (
    <Window
      title="Settings"
      onClose={onClose}
      advanced={(
        <div className="window-grid">
          <Field label="Seed">
            <input className="window-input" inputMode="numeric" value={settings.seed ?? 42} onChange={(event) => set({ seed: number(event.target.value) ?? 42 })} />
          </Field>
          <Field label="Steps (empty = the LoRA's)">
            <input className="window-input" inputMode="numeric" value={settings.steps ?? ''} onChange={(event) => set({ steps: number(event.target.value) })} />
          </Field>
          <Field label="Width (empty = the format's)">
            <input className="window-input" inputMode="numeric" value={settings.size?.width ?? ''} onChange={(event) => {
              const width = number(event.target.value)
              set({ size: width ? { width, height: settings.size?.height ?? width } : undefined })
            }} />
          </Field>
          <Field label="Height">
            <input className="window-input" inputMode="numeric" value={settings.size?.height ?? ''} disabled={!settings.size} onChange={(event) => {
              const height = number(event.target.value)
              if (settings.size) set({ size: { width: settings.size.width, height: height ?? settings.size.width } })
            }} />
          </Field>
          <Field label="Reference image">
            <NkSelect value={settings.refImageSize ?? 'match'} onChange={(event) => set({ refImageSize: event.target.value === 'max' ? 'max' : undefined })}>
              <option value="match">Match the video (fast)</option>
              <option value="max">Full detail (slower)</option>
            </NkSelect>
          </Field>
        </div>
      )}
    >
      <Field label="Speed">
        <NkSelect value={settings.lora ?? 'taomate'} onChange={(event) => set({ lora: event.target.value as Settings['lora'] })}>
          <option value="taomate">TaoMate · 3 steps (steady framing)</option>
          <option value="turbo4">Turbo · 4 steps</option>
        </NkSelect>
      </Field>
      <label className="advanced-toggle">
        <button className="nk-switch" role="switch" aria-checked={!!settings.punchIn} aria-label="Punch-in" onClick={() => set({ punchIn: !settings.punchIn })}>
          <span className="nk-switch-thumb" />
        </button>
        <span data-tooltip="Every other segment is 8 % closer, the usual jump-cut style">Punch-in</span>
      </label>
    </Window>
  )
}
