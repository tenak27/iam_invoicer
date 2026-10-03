// Serveur IAM INVOICER (Node.js) : un seul fichier, dépendances npm externes (pg, PGlite).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    ssr: 'src/server/main.ts',
    outDir: 'out/server',
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'server.cjs' } }
  }
})
