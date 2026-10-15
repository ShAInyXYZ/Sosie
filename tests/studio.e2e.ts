// The Studio in a real browser against the real API, with fake engines (no GPU): Generate gating,
// Try first segment, progress and the result, the one-click flow, and both themes.
// Usage: npm run test:ui
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { createApp } from '../server/app.ts'
import { ROOT, configSchema } from '../server/config.ts'
import { JobManager } from '../server/jobs.ts'
import { fakeEngines } from '../server/testing/fake-engines.ts'

const freePort = () => new Promise<number>((resolve) => {
  const probe = createNetServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as { port: number }
    probe.close(() => resolve(port))
  })
})

const root = mkdtempSync(join(tmpdir(), 'sosie-ui-'))
const shots = join(ROOT, 'test-results')
mkdirSync(shots, { recursive: true })
for (const [kind, id, meta] of [
  ['faces', 'face-alex', { id: 'face-alex', name: 'Alex', kind: 'character', subject: 'a presenter', set: 'a home office', consent: true, createdAt: '2026-10-15T00:00:00Z' }],
  ['voices', 'voice-narrator', { id: 'voice-narrator', name: 'Narrator', kind: 'designed', description: 'a warm, relaxed voice', consent: true, createdAt: '2026-10-15T00:00:00Z' }],
] as const) {
  mkdirSync(join(root, 'data', kind, id), { recursive: true })
  writeFileSync(join(root, 'data', kind, id, kind === 'faces' ? 'face.json' : 'voice.json'), JSON.stringify(meta))
}
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x5a6b7c:s=512x512', '-frames:v', '1', join(root, 'data', 'faces', 'face-alex', 'keyframe.png')])

const [webPort, apiPort] = [await freePort(), await freePort()]
const config = configSchema.parse({ ...JSON.parse(readFileSync(join(ROOT, 'config', 'sosie.example.json'), 'utf8')), ports: { web: webPort, api: apiPort, comfy: 8190 } })
const jobs = new JobManager(config, { root, engines: fakeEngines({ root, delayMs: 2500 }) })
const api = createApp(config, { root, jobs }).listen(apiPort, '127.0.0.1')
const vite = await createServer({
  configFile: false, root: ROOT, cacheDir: join(root, 'vite-cache'), plugins: [react()], logLevel: 'error',
  server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
})
await vite.listen()
const browser = await chromium.launch()

const generate = (page: Page) => page.getByRole('button', { name: 'Generate', exact: true })
const tryFirst = (page: Page) => page.getByRole('button', { name: 'Try first segment', exact: true })

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${webPort}/`, { waitUntil: 'networkidle' })

  // gating: a face first, then the script (the voice defaults to the designed one)
  await page.getByText('Add a face first').waitFor()
  assert.equal(await generate(page).isDisabled(), true, 'Generate waits for a face')
  assert.equal(await tryFirst(page).isDisabled(), true)
  const shoot = async (name: string) => {
    for (const theme of ['dark', 'light']) {
      const toggle = page.getByRole('switch', { name: 'Light theme' })
      if ((await toggle.getAttribute('aria-checked') === 'true') !== (theme === 'light')) await toggle.click()
      await page.waitForTimeout(400) // let colour transitions finish
      await page.screenshot({ path: join(shots, `${name}-${theme}.png`) })
    }
    await page.getByRole('switch', { name: 'Light theme' }).click()
  }
  await shoot('m6-empty')
  await page.locator('#voice-state').filter({ hasText: 'Narrator' }).waitFor()

  await page.getByRole('button', { name: /^Face/ }).click()
  const faceWindow = page.getByRole('dialog', { name: 'Face' })
  await faceWindow.getByRole('option', { name: /Alex/ }).click()
  await faceWindow.waitFor({ state: 'hidden' })
  await page.getByText('Write the script first').waitFor()

  await page.getByRole('button', { name: /^Script/ }).click()
  const scriptWindow = page.getByRole('dialog', { name: 'Script' })
  await scriptWindow.getByRole('textbox', { name: 'Script' }).fill([
    'Hello there, this is the first line.', 'The second line follows it. [calm]', 'A third line keeps going.',
    'Then a fourth one.', 'The fifth line is here.', 'And a sixth line to finish.',
  ].join('\n'))
  await scriptWindow.getByRole('button', { name: 'Close' }).click()
  await scriptWindow.waitFor({ state: 'hidden' })
  // the dialog's close event (which saves the script) is dispatched just after it hides
  await page.waitForFunction(() => !(document.querySelector('.studio-actions .is-primary') as HTMLButtonElement).disabled, null, { timeout: 5000 })

  // Try first segment: progress, then a one-segment result
  await tryFirst(page).click()
  await page.getByRole('status').filter({ hasText: /Filming|Voicing|Planning|Preparing|Waiting|Joining|Writing/ }).first().waitFor({ timeout: 30_000 })
  assert.equal(await generate(page).isDisabled(), true, 'one video at a time')
  await page.locator('video.result-video').waitFor({ timeout: 60_000 })
  assert.equal(await page.locator('.segment').count(), 1, 'Try first segment films one segment')

  // the one-click flow: a new video from the same inputs
  await page.getByRole('button', { name: 'New video', exact: true }).click()
  await generate(page).click()
  await page.locator('video.result-video').waitFor({ timeout: 90_000 })
  assert.ok(await page.locator('.segment').count() >= 2, 'the whole script is filmed')
  const download = page.getByRole('link', { name: 'Download MP4' })
  const href = await download.getAttribute('href')
  const mp4 = await fetch(`http://127.0.0.1:${webPort}${href}`)
  assert.equal(mp4.headers.get('content-type'), 'video/mp4', 'the result downloads as MP4')
  assert.ok(await page.getByRole('button', { name: 'Re-roll segment 1' }).isVisible(), 'each segment can be re-rolled')
  await shoot('m6-result')

  // keyboard: the cards are buttons, Escape closes a window
  await page.getByRole('button', { name: /^Look/ }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('dialog', { name: 'Look' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Look' }).waitFor({ state: 'hidden' })
  assert.deepEqual(errors, [], 'no browser errors')
  console.log('Studio E2E passed: gating with reasons, Face and Script windows, Try first segment, progress, result with download and re-roll, one-click Generate, keyboard, both themes.')
} finally {
  await browser.close()
  await vite.close()
  api.close()
  rmSync(root, { recursive: true, force: true })
}
