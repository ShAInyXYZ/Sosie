import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './config.ts'

const KINDS = { faces: 'faces', voices: 'voices', videos: 'projects' } as const
export type LibraryKind = keyof typeof KINDS

/**
 * "Delete" moves an item into `data/trash/<kind>/` (one atomic rename on the same disk), so a wrong
 * click can be undone by hand; emptying the trash is left to the user.
 */
export function trashItem(kind: LibraryKind, id: string, root = ROOT): boolean {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return false
  const source = join(root, 'data', KINDS[kind], id)
  if (!existsSync(source)) return false
  const bin = join(root, 'data', 'trash', kind)
  mkdirSync(bin, { recursive: true })
  renameSync(source, join(bin, `${id}-${Date.now()}`))
  return true
}
