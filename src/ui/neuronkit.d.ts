declare module 'neuronkit' {
  export function init(root?: Element | Document, options?: { icons?: string }): void
  export function enhance(root: Element | Document): void
  export function drawSeg(element: HTMLElement): void
  export * as format from 'neuronkit/js/format.js'
}
declare module 'neuronkit/js/format.js' {
  export const UNKNOWN: string
  export function num(value: unknown, options?: { digits?: number }): string
  export function unit(value: unknown, unit?: string, options?: { digits?: number }): string
  export function percent(value: unknown, options?: { of?: number; digits?: number }): string
  export function bytes(value: unknown, options?: { si?: boolean; digits?: number }): string
  export function rate(
    value: unknown,
    unit?: string,
    options?: { per?: string; digits?: number },
  ): string
  export function temp(value: unknown, options?: { digits?: number }): string
  export function duration(value: unknown, options?: { parts?: number }): string
  export function plural(value: unknown, word: string, many?: string): string
  export function fraction(a: unknown, b: unknown): string
  export function clock(value: unknown, options?: { seconds?: boolean; utc?: boolean }): string
  export function date(value: unknown, options?: { utc?: boolean }): string
  export function ago(value: unknown, now?: number): string
}
declare module 'neuronkit/css'
