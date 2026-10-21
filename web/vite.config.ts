import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The API server reads the repo-root .env; use its PORT as the proxy target.
  const rootEnv = loadEnv(mode, path.resolve(import.meta.dirname, '..'), '')
  const apiTarget = `http://localhost:${rootEnv.PORT || 8787}`

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // OAuth redirect URIs are registered for this exact origin; fail instead of switching ports.
      strictPort: true,
      proxy: {
        '/api': apiTarget,
        '/auth': apiTarget,
      },
    },
  }
})
