// Sauvegardes automatiques de la base « Ce poste » : une par jour (et au démarrage si
// la dernière date de plus de 24 h), conservées en nombre limité dans un dossier au
// choix — par exemple un dossier Google Drive, OneDrive ou Dropbox pour une copie hors
// du poste. On sauvegarde des copies : la base vivante n'est jamais placée dans le cloud.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './db'

export interface BackupConfig {
  enabled: boolean
  dir: string
  /** Nombre de sauvegardes conservées. */
  keep: number
  last: string | null
  lastError: string | null
}

const PATTERN = /^iam-invoicer-\d{8}-\d{4}\.tar\.gz$/
const DAY = 24 * 3600 * 1000

export function readBackupConfig(file: string, defaultDir: string): BackupConfig {
  try {
    return { enabled: true, dir: defaultDir, keep: 14, last: null, lastError: null, ...JSON.parse(readFileSync(file, 'utf8')) }
  } catch {
    return { enabled: true, dir: defaultDir, keep: 14, last: null, lastError: null }
  }
}

export function writeBackupConfig(file: string, cfg: BackupConfig) {
  writeFileSync(file, JSON.stringify(cfg, null, 2))
}

export function listBackups(dir: string) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => PATTERN.test(f))
    .map((name) => {
      const st = statSync(join(dir, name))
      return { name, size: st.size, date: st.mtime.toISOString() }
    })
    .sort((a, b) => b.name.localeCompare(a.name))
}

/** Écrit une sauvegarde puis supprime les plus anciennes au-delà du nombre conservé. */
export async function runBackup(db: Db, cfg: BackupConfig): Promise<{ file: string; removed: number }> {
  if (!db.dump) throw new Error('Sauvegarde disponible uniquement pour la base de ce poste.')
  mkdirSync(cfg.dir, { recursive: true })
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const name = `iam-invoicer-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.tar.gz`
  const file = join(cfg.dir, name)
  const blob = await db.dump()
  // Écriture puis renommage : un dossier synchronisé ne voit jamais un fichier à moitié écrit.
  writeFileSync(file + '.part', Buffer.from(await blob.arrayBuffer()))
  renameSync(file + '.part', file)
  let removed = 0
  for (const old of listBackups(cfg.dir).slice(Math.max(1, cfg.keep))) {
    unlinkSync(join(cfg.dir, old.name))
    removed++
  }
  return { file, removed }
}

/** Sauvegarde si la dernière date de plus d'un jour. */
export function backupDue(cfg: BackupConfig, now = Date.now()): boolean {
  return cfg.enabled && (!cfg.last || now - Date.parse(cfg.last) >= DAY)
}
