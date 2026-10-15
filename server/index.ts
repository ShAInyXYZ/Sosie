import { createApp } from './app.ts'
import { loadConfig } from './config.ts'

const config = loadConfig()
const app = createApp(config)

app.listen(config.ports.api, '127.0.0.1', () => {
  console.log(`Sosie API on http://127.0.0.1:${config.ports.api}`)
})
