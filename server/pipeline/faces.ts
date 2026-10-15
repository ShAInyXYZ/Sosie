import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { ROOT } from '../config.ts'

export type Face = {
  id: string
  name: string
  kind: 'photo' | 'character'
  /** Who is on camera, used in the H3 prompt; empty = "the person in <Picture 1>". */
  subject: string
  /** The set behind them. */
  set: string
  /** "This is me, or I have this person's permission." Required for photos of real people. */
  consent: boolean
  createdAt: string
}

export function facesDir(root = ROOT) {
  return join(root, 'data', 'faces')
}

export function faceFiles(id: string, root = ROOT) {
  const dir = join(facesDir(root), id)
  return { dir, meta: join(dir, 'face.json'), keyFrame: join(dir, 'keyframe.png') }
}

export function listFaces(root = ROOT): Face[] {
  const dir = facesDir(root)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((id) => faceFiles(id, root).meta)
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')) as Face)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function getFace(id: string, root = ROOT): Face {
  const files = faceFiles(id, root)
  if (!existsSync(files.meta)) throw new Error('That face no longer exists.')
  return JSON.parse(readFileSync(files.meta, 'utf8')) as Face
}

/** Store a ready key frame (PNG) as a face. */
export function saveFace(input: Omit<Face, 'id' | 'createdAt'> & { keyFrame: string }, root = ROOT): Face {
  if (input.kind === 'photo' && !input.consent) throw new Error("Confirm this is you, or that you have this person's permission.")
  if (extname(input.keyFrame).toLowerCase() !== '.png') throw new Error('The key frame must be a PNG.')
  const face: Face = { id: randomUUID(), name: input.name.trim() || 'Face', kind: input.kind, subject: input.subject.trim(), set: input.set.trim(), consent: input.consent, createdAt: new Date().toISOString() }
  const files = faceFiles(face.id, root)
  mkdirSync(files.dir, { recursive: true })
  copyFileSync(input.keyFrame, files.keyFrame)
  writeFileSync(files.meta, JSON.stringify(face, null, 1))
  return face
}
