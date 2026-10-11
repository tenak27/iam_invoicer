// Application web (servie par le serveur IAM INVOICER) et contenu des applications iOS/Android.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

export default defineConfig({
  root: 'src/renderer',
  base: './',
  resolve: { alias: { '@shared': resolve('src/shared') } },
  // Version compilée : comparée à celle du serveur pour proposer la mise à jour
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  build: { outDir: resolve('out/web'), emptyOutDir: true, target: ['es2020', 'safari14'] }
})
