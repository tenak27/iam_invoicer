import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DbConfig } from '../main/db'

/** Base du serveur : PostgreSQL (DATABASE_URL) ou base intégrée dans DATA_DIR. */
export function dbConfigFromEnv(env: NodeJS.ProcessEnv): DbConfig {
  if (env.DATABASE_URL) {
    const u = new URL(env.DATABASE_URL)
    return {
      mode: 'server',
      host: u.hostname,
      port: Number(u.port) || 5432,
      database: decodeURIComponent(u.pathname.slice(1)),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      max: Number(env.DB_POOL_SIZE) || 20
    }
  }
  const dataDir = resolve(env.DATA_DIR ?? 'data')
  mkdirSync(dataDir, { recursive: true })
  return { mode: 'local', dataDir }
}
