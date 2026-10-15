import {
  useId,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
} from 'react'
import { enhance } from 'neuronkit'
import './controls.css'

type EnhancedSelect = HTMLSelectElement & { nkSet?: (value: string) => void }
type EnhancedColour = HTMLDivElement & { nkSet?: (value: string) => void }

/** React owns the source; NeuronKit owns only the trigger and menu beside it. */
export function NkSelect({
  className = '',
  value,
  disabled,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const host = useRef<HTMLDivElement>(null)
  const select = useRef<EnhancedSelect>(null)
  const generatedId = useId()
  const current = useRef({ value, disabled })
  current.current = { value, disabled }

  const sync = () => {
    const source = select.current
    if (!source) return
    // HTMLSelectElement.disabled excludes disabled fieldsets. The generated
    // trigger and popover need the effective state, including their ancestor.
    const unavailable = Boolean(current.current.disabled || source.closest('fieldset[disabled]'))
    if (source.disabled !== unavailable) source.disabled = unavailable
    source.nkSet?.(String(current.current.value ?? source.value))
  }

  useLayoutEffect(() => {
    if (!host.current || !select.current) return
    enhance(host.current)
    sync()
    const observer = new MutationObserver(sync)
    for (let parent = host.current.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLFieldSetElement)
        observer.observe(parent, {
          attributes: true,
          attributeFilter: ['disabled'],
        })
    }
    return () => {
      observer.disconnect()
      host.current?.querySelector<HTMLElement>(':popover-open')?.hidePopover()
    }
  }, [])
  useLayoutEffect(sync)

  return (
    <div className="nk-react-select" ref={host}>
      <select
        {...props}
        id={props.id ?? generatedId}
        className={`nk-select ${className}`}
        value={value}
        disabled={disabled}
        ref={select}
      >
        {children}
      </select>
    </div>
  )
}

/** Native range events stay with React; the kit owns its filled-track reading. */
export function NkSlider({
  className = '',
  value,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const source = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    if (source.current) enhance(source.current)
  }, [])
  useLayoutEffect(() => {
    // This only updates NeuronKit's visual state. It must not create another
    // React edit or history entry when scrubbing, undoing, or seeking.
    source.current?.dispatchEvent(new Event('input', { bubbles: false }))
  }, [value, props.min, props.max])
  return (
    <input
      {...props}
      ref={source}
      className={`nk-slider ${className}`}
      type="range"
      value={value}
    />
  )
}

type ColourProps = {
  id?: string
  'aria-label'?: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
  onBegin?: () => void
  onEnd?: () => void
  onCancel?: () => void
}

/** A small trigger opens the kit's full colour instrument in an owned island. */
export function NkColour({
  value,
  disabled,
  onChange,
  onBegin,
  onEnd,
  onCancel,
  ...props
}: ColourProps) {
  const generatedId = useId()
  const popoverId = `${generatedId}-colour`
  const host = useRef<HTMLDivElement>(null)
  const picker = useRef<EnhancedColour>(null)
  const appliedValue = useRef(value.toLowerCase())
  const callbacks = useRef({ onChange, onBegin, onEnd, onCancel })
  callbacks.current = { onChange, onBegin, onEnd, onCancel }

  useLayoutEffect(() => {
    const root = host.current
    const instrument = picker.current
    if (!root || !instrument) return
    const changed = (event: Event) => {
      if (event.target !== instrument) return
      appliedValue.current = (event as CustomEvent<{ value: string }>).detail.value.toLowerCase()
      callbacks.current.onBegin?.()
      callbacks.current.onChange((event as CustomEvent<{ value: string }>).detail.value)
    }
    const finish = () => callbacks.current.onEnd?.()
    const finishControlGesture = (event: Event) => {
      // Text fields commit on blur. A key or pointer release while typing or
      // selecting text must keep the whole focus session available to Escape.
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return
      finish()
    }
    const cancelPointer = () => callbacks.current.onCancel?.()
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      callbacks.current.onCancel?.()
      if (popover.matches(':popover-open')) popover.hidePopover()
      root.querySelector<HTMLButtonElement>('.nk-react-colour-trigger')?.focus()
    }
    const popover = root.querySelector<HTMLElement>('.nk-popover')!
    const effectiveDisabled = () => {
      const unavailable = Boolean(root.closest('fieldset[disabled]'))
      instrument.inert = unavailable
      if (unavailable && popover.matches(':popover-open')) popover.hidePopover()
    }
    const toggled = (event: Event) => {
      if ((event as ToggleEvent).newState === 'closed') finish()
    }
    instrument.addEventListener('nk:change', changed)
    instrument.addEventListener('pointerup', finishControlGesture)
    instrument.addEventListener('pointercancel', cancelPointer)
    instrument.addEventListener('focusout', finish)
    instrument.addEventListener('keyup', finishControlGesture)
    popover.addEventListener('keydown', cancel)
    popover.addEventListener('toggle', toggled)
    enhance(root)
    effectiveDisabled()
    const observer = new MutationObserver(effectiveDisabled)
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLFieldSetElement)
        observer.observe(parent, {
          attributes: true,
          attributeFilter: ['disabled'],
        })
    }
    return () => {
      observer.disconnect()
      finish()
      instrument.removeEventListener('nk:change', changed)
      instrument.removeEventListener('pointerup', finishControlGesture)
      instrument.removeEventListener('pointercancel', cancelPointer)
      instrument.removeEventListener('focusout', finish)
      instrument.removeEventListener('keyup', finishControlGesture)
      popover.removeEventListener('keydown', cancel)
      popover.removeEventListener('toggle', toggled)
      if (popover.matches(':popover-open')) popover.hidePopover()
    }
  }, [])
  useLayoutEffect(() => {
    // Avoid erasing an in-progress hue choice when its rendered hex is the same
    // (black and gray still have a useful hue waiting behind their zero chroma).
    if (appliedValue.current !== value.toLowerCase()) {
      picker.current?.nkSet?.(value)
      appliedValue.current = value.toLowerCase()
    }
  }, [value])

  return (
    <div className="nk-react-colour" ref={host}>
      <button
        type="button"
        className="nk-button nk-react-colour-trigger"
        id={props.id}
        aria-label={props['aria-label']}
        aria-haspopup="dialog"
        aria-controls={popoverId}
        aria-expanded="false"
        disabled={disabled}
        data-popover={popoverId}
        data-tooltip="Open colour controls"
      >
        <span
          className="nk-react-colour-lens"
          style={{ '--c': value } as CSSProperties}
          aria-hidden="true"
        />
        <span className="nk-react-colour-value">{value.toUpperCase()}</span>
      </button>
      <div
        className="nk-popover nk-react-colour-popover"
        id={popoverId}
        popover="auto"
        role="dialog"
        aria-label={`${props['aria-label'] ?? 'Colour'} controls`}
      >
        <div className="nk-colour is-compact" data-value={value} ref={picker} />
      </div>
    </div>
  )
}
