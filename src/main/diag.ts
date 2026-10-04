// Journal de démarrage du poste : chaque étape (base, fenêtre, erreurs) est notée dans
// <données de l'application>/logs/demarrage.log. En cas de problème, ce fichier suffit à
// diagnostiquer, notamment sur macOS (~/Library/Application Support/IAM INVOICER/logs).

import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

let file: string | null = null

export function diagInit(): string {
  const dir = join(app.getPath('userData'), 'logs')
  try {
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'demarrage.log')
    // Un seul fichier précédent conservé, 512 Ko au plus chacun
    try {
      if (statSync(file).size > 512 * 1024) renameSync(file, join(dir, 'demarrage.precedent.log'))
    } catch {
      /* premier démarrage */
    }
  } catch {
    file = null
  }
  diag(`── IAM INVOICER ${app.getVersion()} · ${process.platform} ${process.arch} · Electron ${process.versions.electron} · ${app.isPackaged ? 'installé' : 'développement'}`)
  return dir
}

export function diag(message: string) {
  const line = `${new Date().toISOString()} ${message}`
  if (process.env.IAM_SELFTEST) console.log(line)
  if (!file) return
  try {
    appendFileSync(file, line + '\n')
  } catch {
    /* journal non bloquant */
  }
}

export const errText = (e: unknown) => (e instanceof Error ? `${e.message}${e.stack ? `\n${e.stack.split('\n').slice(1, 6).join('\n')}` : ''}` : String(e))
