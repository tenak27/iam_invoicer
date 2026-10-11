import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  // hookTimeout : l'ouverture d'une base intégrée (beforeAll) dépasse les 10 s par défaut
  // quand la machine est chargée, ce qui faisait échouer des fichiers entiers par intermittence.
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000, hookTimeout: 90000 }
})
