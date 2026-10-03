// Base locale de travail de l'application de bureau reliée à un serveur en ligne :
// dernières données consultées ou préchargées, et saisies en attente d'envoi.
// Un fichier JSON par serveur et par utilisateur, réécrit de façon atomique
// (fichier temporaire puis renommage) : une coupure de courant ne le corrompt pas.
// La file d'attente est écrite immédiatement ; le cache est regroupé (500 ms).

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { KeyValueStore } from '../shared/offline'

const URGENT_PREFIX = 'iam.offline.'
const CACHE_PREFIX = 'iam.cache.'

export interface FileStore extends KeyValueStore {
  /** Écrit immédiatement les changements en attente. */
  flush(): void
  /** Taille approximative des données, en octets. */
  size(): number
  /** Vide le cache des lectures ; la file d'attente est conservée. */
  clearCache(): void
}

export function createFileStore(file: string): FileStore {
  let data: Record<string, string> = {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object') data = parsed
  } catch {
    /* première utilisation, ou fichier illisible : on repart d'une base vide */
  }
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    mkdirSync(dirname(file), { recursive: true })
    const tmp = file + '.tmp'
    writeFileSync(tmp, JSON.stringify(data))
    try {
      renameSync(tmp, file)
    } catch (e) {
      rmSync(tmp, { force: true })
      throw e
    }
  }
  const changed = (key: string) => {
    if (key.startsWith(URGENT_PREFIX)) return flush()
    if (!timer) {
      timer = setTimeout(flush, 500)
      timer.unref?.()
    }
  }

  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v
      changed(k)
    },
    removeItem: (k) => {
      if (!Object.prototype.hasOwnProperty.call(data, k)) return
      delete data[k]
      changed(k)
    },
    flush,
    size: () => Object.entries(data).reduce((n, [k, v]) => n + k.length + v.length, 0),
    clearCache: () => {
      for (const k of Object.keys(data)) if (k.startsWith(CACHE_PREFIX)) delete data[k]
      flush()
    }
  }
}
