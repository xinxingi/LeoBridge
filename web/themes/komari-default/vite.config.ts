import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
export default defineConfig({
  define: { __BUILD_TIME__: 'null' },
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/', plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: '../../../dist/komari-default-public', emptyOutDir: true, assetsInlineLimit: 2048 }
})
