import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { ROOT, configSchema } from '../server/config.ts'
import { applyUpdate, buildInfo, checkForUpdate } from '../server/update.ts'

// "Check for updates" against a stand-in official repository: patch notes, fast-forward only, local work protected.
const dir = mkdtempSync(join(tmpdir(), 'sosie-update-'))
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, stdio: 'pipe' }).toString().trim()
const commit = (cwd: string, file: string, text: string, message: string) => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', message)
}
const official = join(dir, 'official')
const local = join(dir, 'local')
mkdirSync(official)
git(official, 'init', '-q', '-b', 'main')
commit(official, 'package.json', '{ "name": "sosie", "version": "0.1.0" }\n', 'First release')
git(dir, 'clone', '-q', official, local)
commit(official, 'notes.txt', 'two\n', 'Second change\n\nWhat it does, in a sentence.\n\nCo-Authored-By: Someone <someone@example.com>')
commit(official, 'notes.txt', 'three\n', 'Third change')
const example = JSON.parse(readFileSync(join(ROOT, 'config', 'sosie.example.json'), 'utf8'))
const config = configSchema.parse({ ...example, update: { repo: official, branch: 'main' } })
const steps = { install: false, build: false, restart: false }

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('updates', () => {
  test('lists what is new, newest first, without co-author trailers', async () => {
    const status = await checkForUpdate(config, local)
    expect([status.behind, status.ahead, status.dirty, status.canUpdate]).toEqual([2, 0, false, true])
    expect(status.notes.map((note) => note.subject)).toEqual(['Third change', 'Second change'])
    expect(status.notes[1].body).toBe('What it does, in a sentence.')
    expect(status.current.version).toBe('0.1.0')
  })

  test('waits while tracked files are edited', async () => {
    writeFileSync(join(local, 'package.json'), '{ "name": "sosie", "version": "0.1.0", "edited": true }\n')
    const status = await checkForUpdate(config, local)
    expect(status.canUpdate).toBe(false)
    expect(status.reason).toContain('edited')
    await expect(applyUpdate(config, local, steps)).rejects.toThrow('edited')
    git(local, 'checkout', '--', 'package.json')
  })

  test('fast-forwards to the official commit, then is up to date', async () => {
    const result = await applyUpdate(config, local, steps)
    expect(result.to).toBe(git(official, 'rev-parse', 'HEAD'))
    expect((await buildInfo(local)).commit).toBe(result.to)
    expect((await checkForUpdate(config, local)).reason).toBe('Up to date.')
  })

  test('never touches local commits', async () => {
    commit(local, 'mine.txt', 'mine\n', 'My own change')
    expect((await checkForUpdate(config, local)).reason).toContain('1 commit ahead')
    commit(official, 'notes.txt', 'four\n', 'Fourth change')
    const status = await checkForUpdate(config, local)
    expect([status.behind, status.ahead, status.canUpdate]).toEqual([1, 1, false])
    expect(status.reason).toContain('by hand')
  })

  test('a copy without git says where to get the latest', async () => {
    const plain = join(dir, 'plain')
    mkdirSync(plain)
    writeFileSync(join(plain, 'package.json'), '{ "version": "0.1.0" }\n')
    const status = await checkForUpdate(config, plain)
    expect(status.canUpdate).toBe(false)
    expect(status.reason).toContain('not a git clone')
  })
})
