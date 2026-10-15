import { basename } from 'node:path'

export type SendResult =
  | { sent: true; folderPath: string }
  | { sent: false; reason: string; bundle: string }

/**
 * Hand a finished bundle to MOceanX. Its import route creates (or extends) a saved project, which the
 * user then opens in MOceanX. Without a MOceanX that reads bundle v1, the bundle folder is returned.
 */
export async function sendToMoceanx(baseUrl: string, bundleDir: string): Promise<SendResult> {
  let health: { sosieBundle?: number }
  try {
    health = await (await fetch(new URL('/api/health', baseUrl), { signal: AbortSignal.timeout(3000) })).json() as { sosieBundle?: number }
  } catch {
    return { sent: false, reason: 'MOceanX is not running. Start it, or open the bundle folder in MOceanX yourself.', bundle: bundleDir }
  }
  // never send video to a MOceanX without video layers: its export would break
  if (health.sosieBundle !== 1) return { sent: false, reason: 'This MOceanX cannot import Sosie videos yet. Update it.', bundle: bundleDir }
  const project = `projects/${basename(bundleDir).replace(/\.sosie$/, '')}.motion`
  const response = await fetch(new URL('/api/sosie/import', baseUrl), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bundlePath: bundleDir, folderPath: project }),
  })
  const body = await response.json().catch(() => ({})) as { folderPath?: string; error?: string }
  if (!response.ok || !body.folderPath) return { sent: false, reason: body.error ?? `MOceanX answered ${response.status}.`, bundle: bundleDir }
  return { sent: true, folderPath: body.folderPath }
}
