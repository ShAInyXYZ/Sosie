import type { SVGProps } from 'react'
import spriteUrl from 'neuronkit/icons/icons.svg?url'

export { spriteUrl }
type Props = SVGProps<SVGSVGElement> & {
  size?: number | string
  weight?: string
}

export function KitIcon({
  name,
  size = 16,
  className = '',
  children,
  ...props
}: Props & { name?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`nk-icon ${className}`}
      aria-hidden="true"
      focusable="false"
      {...props}
      style={{ width: size, height: size, ...props.style }}
    >
      {name ? <use href={`${spriteUrl}#${name}`} /> : children}
    </svg>
  )
}
const icon = (name: string, transform?: string) =>
  function Icon({ weight: _weight, style, ...props }: Props) {
    return <KitIcon name={name} style={transform ? { transform, ...style } : style} {...props} />
  }
export const ArrowCounterClockwise = icon('refresh', 'scaleX(-1)')
export const ArrowClockwise = icon('refresh')
export const CaretDown = icon('chevron-down')
export const CaretLeft = icon('chevron-right', 'rotate(180deg)')
export const CaretRight = icon('chevron-right')
export const Check = icon('check')
export const DownloadSimple = icon('download')
export const Export = icon('scene-render')
export const FloppyDisk = icon('disk')
export const FolderOpen = icon('folder')
export const FilmStrip = icon('scene-render')
export const Plus = icon('plus')
export const UploadSimple = icon('upload')
export const X = icon('x')
export const Copy = icon('copy')
export const CursorClick = icon('web-cursor')
export const Eye = icon('eye')
export const ImageSquare = icon('image')
export const Lock = icon('lock')
export const LockSimple = Lock
export const MagnifyingGlass = icon('search')
export const Trash = icon('trash')
export const ArrowsOut = icon('transform-scale')
export const MagnifyingGlassMinus = icon('minus')
export const MagnifyingGlassPlus = icon('plus')
export const ArrowDown = icon('arrow-up', 'rotate(180deg)')
export const ArrowUp = icon('arrow-up')
export const Pause = icon('pause')
export const Play = icon('play')
export const Sun = icon('scene-sun')
export const Moon = icon('view-solid')

// Editor-specific geometry, using the same 24-unit grid and stroke as the kit.
export function Keyboard({ weight: _weight, ...props }: Props) {
  return (
    <KitIcon {...props}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10" />
    </KitIcon>
  )
}
export function LockOpen({ weight: _weight, ...props }: Props) {
  return (
    <KitIcon {...props}>
      <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
      <path d="M8 10.5V8a4 4 0 0 1 7.5-2M12 14.5v2" />
    </KitIcon>
  )
}
export function SkipBack({ weight: _weight, ...props }: Props) {
  return (
    <KitIcon {...props}>
      <path d="M5 5v14M18 5l-9 7 9 7Z" />
    </KitIcon>
  )
}
export function Rectangle({ weight: _weight, ...props }: Props) {
  return (
    <KitIcon {...props}>
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </KitIcon>
  )
}
export function Circle({ weight: _weight, ...props }: Props) {
  return (
    <KitIcon {...props}>
      <circle cx="12" cy="12" r="8" />
    </KitIcon>
  )
}
export function TextT({ weight: _weight, ...props }: Props) {
  return (
    <KitIcon {...props}>
      <path d="M4 7V4h16v3M12 4v16M8 20h8" />
    </KitIcon>
  )
}
export function Diamond({ weight, ...props }: Props) {
  return (
    <KitIcon {...props}>
      <path d="m12 3 9 9-9 9-9-9Z" fill={weight === 'fill' ? 'currentColor' : 'none'} />
    </KitIcon>
  )
}
export function EyeSlash({ weight: _weight, ...props }: Props) {
  return (
    <KitIcon {...props}>
      <use href={`${spriteUrl}#eye`} />
      <path d="M3 3l18 18" />
    </KitIcon>
  )
}
