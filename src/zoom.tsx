import { useRef, useState, type PointerEvent, type WheelEvent } from 'react'

/** An image you can zoom (wheel, around the cursor) and pan (drag). Double-click fits it again. */
export function ZoomImage({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const onWheel = (event: WheelEvent) => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return
    const scale = Math.min(8, Math.max(1, view.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)))
    // keep the point under the cursor still
    const px = event.clientX - rect.left - rect.width / 2
    const py = event.clientY - rect.top - rect.height / 2
    const k = scale / view.scale
    setView(scale === 1 ? { scale: 1, x: 0, y: 0 } : { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k })
  }
  const onPointerDown = (event: PointerEvent) => {
    if (view.scale === 1) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: view.x, y: view.y, startX: event.clientX, startY: event.clientY }
  }
  const onPointerMove = (event: PointerEvent) => {
    const start = drag.current
    if (!start) return
    setView((current) => ({ ...current, x: start.x + event.clientX - start.startX, y: start.y + event.clientY - start.startY }))
  }
  const end = () => { drag.current = null }

  return (
    <div
      ref={box}
      className={`zoom-image ${view.scale > 1 ? 'is-zoomed' : ''} ${className}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => setView({ scale: 1, x: 0, y: 0 })}
      data-tooltip="Scroll to zoom · drag to move · double-click to fit"
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      />
    </div>
  )
}
