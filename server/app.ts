import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import { ROOT, type SosieConfig } from './config.ts'
import { systemStatus } from './system.ts'

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]']

export const VERSION = '0.1.0'

/** Only this machine may talk to Sosie: localhost Host header, and a local Origin when one is sent. */
function localOnly(config: SosieConfig) {
  const allowedOrigins = new Set(
    LOCAL_HOSTS.flatMap((host) => [config.ports.web, config.ports.api].map((port) => `http://${host}:${port}`)),
  )
  return (request: Request, response: Response, next: NextFunction) => {
    let host = ''
    try {
      host = new URL(`http://${request.headers.host ?? ''}`).hostname
    } catch {
      host = ''
    }
    if (!LOCAL_HOSTS.includes(host)) {
      response.status(403).json({ error: 'Sosie accepts requests addressed to localhost only.' })
      return
    }
    const origin = request.headers.origin
    if (origin && !allowedOrigins.has(origin)) {
      response.status(403).json({ error: 'Only the Sosie app can use this API.' })
      return
    }
    next()
  }
}

export function createApp(config: SosieConfig) {
  const app = express()
  app.disable('x-powered-by')
  app.use(localOnly(config))
  app.use(express.json({ limit: '2mb' }))

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true, app: 'sosie', version: VERSION })
  })

  app.get('/api/system', async (_request, response) => {
    response.json(await systemStatus(config))
  })

  const dist = join(ROOT, 'dist')
  if (existsSync(join(dist, 'index.html'))) {
    app.use(express.static(dist))
    app.get(/^\/(?!api\/).*/, (_request, response) => response.sendFile(join(dist, 'index.html')))
  }
  return app
}
