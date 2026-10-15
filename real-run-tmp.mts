import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
const errors: string[] = []
page.on('pageerror', (e) => errors.push(e.message))
try {
  await page.goto('http://127.0.0.1:3190/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /^Face/ }).click()
  await page.getByRole('dialog', { name: 'Face' }).getByRole('option', { name: /Photo · Lena/ }).click()
  await page.getByRole('button', { name: /^Script/ }).click()
  await page.getByRole('dialog', { name: 'Script' }).getByRole('textbox', { name: 'Script' }).fill("Hi, this is a quick test of Sosie's one-click flow.\nOnly the face and the script were chosen; everything else kept its default.")
  await page.getByRole('dialog', { name: 'Script' }).getByRole('button', { name: 'Close' }).click()
  await page.waitForFunction(() => !(document.querySelector('.studio-actions .is-primary') as HTMLButtonElement).disabled, null, { timeout: 10_000 })
  const voice = await page.locator('#voice-state').textContent()
  const look = await page.locator('#look-state').textContent()
  const started = Date.now()
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  await page.locator('video.result-video').waitFor({ timeout: 30 * 60_000 })
  const jobId = await page.evaluate(() => localStorage.getItem('sosie-job'))
  await page.screenshot({ path: '/home/shiny/Documents/GitHub/Sosie/data/spike/real-run-result.png' })
  console.log(JSON.stringify({ voice, look, seconds: Math.round((Date.now() - started) / 1000), jobId, errors }))
} catch (error) {
  console.log('FAILED:', (error as Error).message.split('\n').slice(0, 6).join(' | '), errors)
  await page.screenshot({ path: '/home/shiny/Documents/GitHub/Sosie/data/spike/real-run-fail.png' })
} finally {
  await browser.close()
}
