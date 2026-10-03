// Application web (servie par le serveur IAM INVOICER) et contenu des applications iOS/Android.
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  base: './',
  resolve: { alias: { '@shared': resolve('src/shared') } },
  plugins: [react()],
  build: { outDir: resolve('out/web'), emptyOutDir: true, target: ['es2020', 'safari14'] }
})
