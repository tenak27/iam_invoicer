import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupDue, listBackups, readBackupConfig, runBackup } from '../src/main/autoBackup'
import { openDb } from '../src/main/db'

describe('Sauvegardes automatiques', () => {
  it('écrit une sauvegarde lisible et ne garde que les plus récentes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'iam-bk-'))
    const db = await openDb({ mode: 'local', dataDir: join(dir, 'data') })
    // Anciennes sauvegardes et fichier étranger (jamais supprimé)
    for (const d of ['20250101-0800', '20250102-0800', '20250103-0800']) writeFileSync(join(dir, `iam-invoicer-${d}.tar.gz`), 'ancienne')
    writeFileSync(join(dir, 'autre-fichier.txt'), 'à garder')
    const cfg = { ...readBackupConfig(join(dir, 'absent.json'), dir), keep: 2 }
    const r = await runBackup(db, cfg)
    const files = listBackups(dir)
    expect(files).toHaveLength(2)
    expect(files[0].name).toBe(r.file.split(/[\\/]/).pop())
    expect(files[0].size).toBeGreaterThan(10_000) // vraie archive de la base
    expect(r.removed).toBe(2)
    expect(listBackups(dir).some((f) => f.name.includes('20250103'))).toBe(true)
    await db.close()
  })

  it('sauvegarde due une fois par jour', () => {
    const base = { enabled: true, dir: '', keep: 14, last: null, lastError: null }
    expect(backupDue(base)).toBe(true)
    expect(backupDue({ ...base, last: new Date().toISOString() })).toBe(false)
    expect(backupDue({ ...base, last: new Date(Date.now() - 25 * 3600_000).toISOString() })).toBe(true)
    expect(backupDue({ ...base, enabled: false })).toBe(false)
  })
})
