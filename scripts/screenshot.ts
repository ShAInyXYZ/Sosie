// Screenshot the running app in both themes for docs/media.
// Usage: npx tsx scripts/screenshot.ts <url> <out-prefix> [width] [height]
import { chromium } from 'playwright'

const [url, prefix, width = '1600', height = '1000'] = process.argv.slice(2)
if (!url || !prefix) {
  console.error('usage: screenshot.ts <url> <out-prefix> [width] [height]')
  process.exit(2)
}

const browser = await chromium.launch()
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: Number(width), height: Number(height) } })
    await context.addInitScript((value) => localStorage.setItem('sosie-theme', value), theme)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.screenshot({ path: `${prefix}-${theme}.png` })
    console.log(`${prefix}-${theme}.png${errors.length ? `  errors: ${errors.join(' | ')}` : ''}`)
    await context.close()
  }
} finally {
  await browser.close()
}
