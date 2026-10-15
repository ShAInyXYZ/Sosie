import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ROOT, type SosieConfig } from './config.ts'

const run = promisify(execFile)

/** One change between this build and the official one, from its commit. */
export type PatchNote = { commit: string; date: string; subject: string; body: string }

export type BuildInfo = { version: string; commit: string; date: string }

export type UpdateStatus = {
  current: BuildInfo
  upstream?: { repo: string; branch: string; commit: string; date: string }
  /** Official commits this build doesn't have, and local commits the official branch doesn't have. */
  behind: number
  ahead: number
  /** Edited tracked files: an update would mix them with new code, so it waits. */
  dirty: boolean
  notes: PatchNote[]
  canUpdate: boolean
  /** Why there is nothing to do, or why it must be done by hand. */
  reason?: string
  checkedAt: string
}

export type UpdateResult = { from: string; to: string; notes: PatchNote[]; followUps: string[] }

const git = async (root: string, args: string[], timeout = 30_000) =>
  (await run('git', args, { cwd: root, timeout, maxBuffer: 8 * 1024 * 1024 })).stdout.trim()

const isClone = (root: string) => existsSync(join(root, '.git'))

/** This build: package version plus the commit it was built from (no network). */
export async function buildInfo(root = ROOT): Promise<BuildInfo> {
  const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version
  if (!isClone(root)) return { version, commit: 'unknown', date: '' }
  const [commit, date] = (await git(root, ['log', '-1', '--format=%H%x1f%cI'])).split('\x1f')
  return { version, commit, date }
}

/** Fetch the official branch (into FETCH_HEAD only: no remote or branch of the user's changes) and compare. */
export async function checkForUpdate(config: SosieConfig, root = ROOT): Promise<UpdateStatus> {
  const current = await buildInfo(root)
  const base = { current, behind: 0, ahead: 0, dirty: false, notes: [] as PatchNote[], canUpdate: false, checkedAt: new Date().toISOString() }
  if (!isClone(root)) return { ...base, reason: `This copy is not a git clone, so it cannot update itself. Download the latest from ${config.update.repo.replace(/\.git$/, '')}.` }
  const { repo, branch } = config.update
  try {
    await git(root, ['fetch', '--quiet', '--no-tags', repo, branch], 60_000)
  } catch (error) {
    return { ...base, reason: `Could not reach ${repo}: ${String((error as Error).message).split('\n')[0].slice(0, 160)}` }
  }
  const [commit, date] = (await git(root, ['log', '-1', '--format=%H%x1f%cI', 'FETCH_HEAD'])).split('\x1f')
  const [ahead, behind] = (await git(root, ['rev-list', '--left-right', '--count', 'HEAD...FETCH_HEAD'])).split(/\s+/).map(Number)
  const dirty = (await git(root, ['status', '--porcelain', '--untracked-files=no'])).length > 0
  const log = behind ? await git(root, ['log', '--max-count=50', '--format=%H%x1f%cI%x1f%s%x1f%b%x1e', 'HEAD..FETCH_HEAD']) : ''
  const notes = log.split('\x1e').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [hash, when, subject, body] = entry.split('\x1f')
    // co-author trailers are not news
    return { commit: hash, date: when, subject, body: (body ?? '').replace(/^Co-Authored-By:.*$/gim, '').trim() }
  })
  const reason = behind === 0 && ahead === 0 ? 'Up to date.'
    : behind === 0 ? `This build is ${ahead} commit${ahead === 1 ? '' : 's'} ahead of the official one.`
      : ahead > 0 ? 'This build has its own commits. Merge the official changes by hand (git pull).'
        : dirty ? 'Some files here were edited. Commit or stash them, then update.'
          : undefined
  return { ...base, upstream: { repo, branch, commit, date }, behind, ahead, dirty, notes, canUpdate: !reason, reason }
}

/**
 * Fast-forward to the official branch, reinstall packages if they changed, rebuild the app, and restart the API.
 * Never merges or overwrites: anything but a clean fast-forward is refused with the reason.
 */
export async function applyUpdate(config: SosieConfig, root = ROOT, steps = { install: true, build: true, restart: true }): Promise<UpdateResult> {
  const status = await checkForUpdate(config, root)
  if (!status.canUpdate || !status.upstream) throw new Error(status.reason ?? 'Nothing to update.')
  const from = status.current.commit
  const to = status.upstream.commit
  await git(root, ['merge', '--ff-only', '--quiet', to])
  const changed = (await git(root, ['diff', '--name-only', from, to])).split('\n')
  const followUps: string[] = []
  if (changed.some((file) => file.startsWith('py/') && /requirements|constraints|setup\.sh/.test(file))) followUps.push('Python packages changed: run py/setup.sh.')
  if (changed.some((file) => file.startsWith('comfy/') && /lock\.json|setup\.sh|constraints/.test(file))) followUps.push("Sosie's ComfyUI changed: run comfy/setup.sh.")
  if (changed.includes('config/sosie.example.json')) followUps.push('New settings exist: compare config/sosie.example.json with your sosie.local.json.')
  if (steps.install && changed.some((file) => file === 'package.json' || file === 'package-lock.json')) {
    await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: root, timeout: 15 * 60_000, maxBuffer: 32 * 1024 * 1024 })
  }
  if (steps.build) await run('npm', ['run', 'build'], { cwd: root, timeout: 10 * 60_000, maxBuffer: 32 * 1024 * 1024 })
  if (steps.restart) {
    // a separate session outlives this process; the pause lets the HTTP answer leave first
    spawn('bash', ['-c', 'sleep 2; scripts/stop.sh api; scripts/start.sh api'], { cwd: root, detached: true, stdio: 'ignore' }).unref()
  }
  return { from, to, notes: status.notes, followUps }
}
