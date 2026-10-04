// Accès base de données : PostgreSQL embarqué (PGlite) pour un poste unique,
// ou serveur PostgreSQL du réseau local pour travailler en équipe.
// Le même SQL est utilisé dans les deux modes.

import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { MIGRATIONS } from './schema'

export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>
  one<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>
  close(): Promise<void>
  /** Mode poste unique : archive complète de la base (sauvegarde). */
  dump?: () => Promise<Blob>
}

export type DbConfig =
  | { mode: 'local'; dataDir?: string } // dataDir absent = base en mémoire (tests)
  | { mode: 'server'; host: string; port: number; database: string; user: string; password: string; max?: number; idleTimeoutMillis?: number }

type Exec = (sql: string, params?: unknown[]) => Promise<any[]>

function wrap(exec: Exec, tx: Db['tx'], close: Db['close']): Db {
  return {
    query: exec,
    one: async (sql, params) => (await exec(sql, params))[0],
    tx,
    close
  }
}

async function openLocal(dataDir?: string): Promise<Db> {
  const lite = dataDir ? new PGlite(dataDir) : new PGlite()
  await lite.waitReady
  const exec: Exec = async (sql, params) => (await lite.query(sql, params as any[])).rows as any[]
  // PGlite n'a qu'une connexion : on sérialise les transactions.
  let chain: Promise<unknown> = Promise.resolve()
  const tx: Db['tx'] = (fn) => {
    const run = chain.then(() =>
      lite.transaction(async (t) => {
        const texec: Exec = async (sql, params) => (await t.query(sql, params as any[])).rows as any[]
        const inner: Db = wrap(texec, (f) => f(inner), async () => {})
        return fn(inner)
      })
    )
    chain = run.catch(() => {})
    return run
  }
  return { ...wrap(exec, tx, () => lite.close()), dump: () => lite.dumpDataDir('gzip') }
}

/** Restaure une sauvegarde dans un nouveau dossier de données. */
export async function restoreLocal(archive: Blob, dataDir: string): Promise<void> {
  const lite = new PGlite(dataDir, { loadDataDir: archive })
  await lite.waitReady
  await lite.query('SELECT COUNT(*) FROM users')
  await lite.close()
}

let typesConfigured = false
function configurePgTypes(): void {
  if (typesConfigured) return
  typesConfigured = true
  pg.types.setTypeParser(20, (v) => parseInt(v, 10)) // int8
  pg.types.setTypeParser(1700, (v) => parseFloat(v)) // numeric
}

async function openServer(cfg: Extract<DbConfig, { mode: 'server' }>): Promise<Db> {
  configurePgTypes()
  const pool = new pg.Pool({ ...cfg, max: cfg.max ?? 5, connectionTimeoutMillis: 5000 })
  const exec: Exec = async (sql, params) => (await pool.query(sql, params as any[])).rows
  const tx: Db['tx'] = async (fn) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const texec: Exec = async (sql, params) => (await client.query(sql, params as any[])).rows
      const inner: Db = wrap(texec, (f) => f(inner), async () => {})
      const result = await fn(inner)
      await client.query('COMMIT')
      return result
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }
  }
  return wrap(exec, tx, () => pool.end())
}

export async function openDb(cfg: DbConfig): Promise<Db> {
  const db = cfg.mode === 'local' ? await openLocal(cfg.dataDir) : await openServer(cfg)
  await migrate(db)
  return db
}

async function migrate(db: Db): Promise<void> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_version (version INT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())')
  const row = await db.one<{ v: number }>('SELECT COALESCE(MAX(version), 0)::int AS v FROM schema_version')
  const current = row?.v ?? 0
  for (let i = current; i < MIGRATIONS.length; i++) {
    await db.tx(async (t) => {
      // Plusieurs postes peuvent démarrer en même temps : on revérifie sous verrou.
      await t.query('LOCK TABLE schema_version IN EXCLUSIVE MODE')
      const again = await t.one<{ v: number }>('SELECT COALESCE(MAX(version), 0)::int AS v FROM schema_version')
      if ((again?.v ?? 0) > i) return
      for (const stmt of MIGRATIONS[i].split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
        await t.query(stmt)
      }
      await t.query('INSERT INTO schema_version (version) VALUES ($1)', [i + 1])
    })
  }
}
