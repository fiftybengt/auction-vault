import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Served from GitHub Pages at /auction-vault/. Routing is hash-based (no SPA fallback there).
export default defineConfig({
  base: '/auction-vault/',
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 400,
  },
})
