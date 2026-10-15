/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { loadConfig } from './server/config.ts'

const { ports } = loadConfig()

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: ports.web,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${ports.api}` },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
