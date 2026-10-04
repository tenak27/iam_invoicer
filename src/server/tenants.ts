// Hébergement de plusieurs clients sur un même serveur (VPS) : chaque client a SA base
// PostgreSQL, avec son propre utilisateur et son propre mot de passe. Personne d'autre ne
// peut s'y connecter (droits PostgreSQL), et les applications du client n'y accèdent que
// par l'API, à l'adresse https://<domaine>/t/<client>.
//
// Le registre des clients (table cloud_tenants) est dans la base principale du serveur.
// La création d'une base passe par un compte PostgreSQL administrateur (ADMIN_DATABASE_URL,
// ou DATABASE_URL s'il a les droits), utilisé uniquement pour créer, modifier et supprimer.

import { randomBytes, randomInt } from 'node:crypto'
import pg from 'pg'
import { openDb, type Db } from '../main/db'

export interface TenantRow {
  slug: string
  name: string
  db_name: string
  db_user: string
  db_password: string
  status: 'active' | 'suspended'
  setup_code: string | null
  contact: string | null
  licence_number: string | null
  notes: string | null
  created_at: string
}

/** Création des bases : PostgreSQL réel en production, simulé dans les tests. */
export interface Provisioner {
  createDatabase(name: string, password: string): Promise<void>
  setPassword(name: string, password: string): Promise<void>
  dropDatabase(name: string): Promise<void>
  databaseSize(name: string): Promise<number | null>
  open(name: string, password: string): Promise<Db>
  /** Connexion directe (outils de l'éditeur, sauvegardes) : hôte et port vus du serveur. */
  endpoint(): { host: string; port: number }
  /** Interdit aux comptes des clients de se connecter à une base (base principale). */
  protectDatabase(name: string): Promise<void>
}

const IDENT = /^iam_[a-z][a-z0-9_]{1,40}$/
const ident = (name: string) => {
  if (!IDENT.test(name)) throw new Error(`Nom de base invalide : ${name}`)
  return `"${name}"`
}

export function pgProvisioner(adminUrl: string): Provisioner {
  const u = new URL(adminUrl)
  const host = u.hostname
  const port = Number(u.port || 5432)
  const admin = async <T>(fn: (c: pg.Client) => Promise<T>): Promise<T> => {
    const c = new pg.Client({ connectionString: adminUrl })
    await c.connect()
    try {
      return await fn(c)
    } finally {
      await c.end().catch(() => {})
    }
  }
  return {
    endpoint: () => ({ host, port }),
    async protectDatabase(name) {
      await admin((c) => c.query(`REVOKE CONNECT ON DATABASE "${name.replace(/"/g, '""')}" FROM PUBLIC`)).catch((e) => {
        console.warn(`Protection de la base ${name} impossible : ${e?.message ?? e}`)
      })
    },
    async createDatabase(name, password) {
      const id = ident(name)
      await admin(async (c) => {
        await c.query(`CREATE ROLE ${id} LOGIN PASSWORD '${password.replace(/'/g, "''")}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 20`)
        try {
          // CREATE DATABASE ne peut pas s'exécuter dans une transaction
          await c.query(`CREATE DATABASE ${id} OWNER ${id} ENCODING 'UTF8' TEMPLATE template0`)
        } catch (e) {
          await c.query(`DROP ROLE IF EXISTS ${id}`).catch(() => {})
          throw e
        }
        // Seul le propriétaire (et l'administrateur) peut se connecter à cette base
        await c.query(`REVOKE ALL ON DATABASE ${id} FROM PUBLIC`)
      })
    },
    async setPassword(name, password) {
      await admin((c) => c.query(`ALTER ROLE ${ident(name)} PASSWORD '${password.replace(/'/g, "''")}'`))
    },
    async dropDatabase(name) {
      const id = ident(name)
      await admin(async (c) => {
        await c.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name])
        await c.query(`DROP DATABASE IF EXISTS ${id}`)
        await c.query(`DROP ROLE IF EXISTS ${id}`)
      })
    },
    async databaseSize(name) {
      return admin(async (c) => {
        const r = await c.query('SELECT pg_database_size($1)::bigint AS n', [name])
        return Number(r.rows[0]?.n ?? 0)
      }).catch(() => null)
    },
    open: (name, password) => openDb({ mode: 'server', host, port, database: name, user: name, password, max: 4, idleTimeoutMillis: 60_000 })
  }
}

const CONTROL_SQL = `
CREATE TABLE IF NOT EXISTS cloud_tenants (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  db_name TEXT NOT NULL UNIQUE,
  db_user TEXT NOT NULL,
  db_password TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  setup_code TEXT,
  contact TEXT,
  licence_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`

/** Identifiant d'adresse à partir de la raison sociale : « Pharmacie du Progrès SARL » → « pharmacie_du_progres ». */
export function slugify(name: string): string {
  const s = String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(sarl|sa|sas|sasu|suarl|snc|gie|ets|etablissements?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)
    .replace(/_+$/, '')
  return /^[a-z]/.test(s) ? s : `c_${s}`.slice(0, 30)
}
export const SLUG = /^[a-z][a-z0-9_]{2,30}$/

const newPassword = () => randomBytes(24).toString('base64url')
/** Code d'activation lisible (sans 0/O ni 1/I), demandé à la première configuration. */
export function newSetupCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const part = () => Array.from({ length: 4 }, () => A[randomInt(A.length)]).join('')
  return `${part()}-${part()}-${part()}`
}

export interface CreatedTenant {
  slug: string
  name: string
  path: string
  db_name: string
  db_user: string
  db_password: string
  db_host: string
  db_port: number
  setup_code: string
}

export class TenantManager {
  private open = new Map<string, { db: Promise<Db>; used: number; password: string }>()
  private sweeper: NodeJS.Timeout

  constructor(private control: Db, private prov: Provisioner, private idleMs = 30 * 60_000) {
    // Bases inutilisées depuis longtemps : connexions fermées (rouvertes à la demande)
    this.sweeper = setInterval(() => void this.sweep(), 60_000)
    this.sweeper.unref()
  }

  async init() {
    await this.control.query(CONTROL_SQL)
  }

  async list(): Promise<(Omit<TenantRow, 'db_password'> & { size: number | null })[]> {
    const rows = await this.control.query<TenantRow>('SELECT * FROM cloud_tenants ORDER BY created_at DESC, slug')
    return Promise.all(rows.map(async ({ db_password: _p, ...r }) => ({ ...r, size: await this.prov.databaseSize(r.db_name) })))
  }

  async get(slug: string): Promise<TenantRow | null> {
    if (!SLUG.test(slug)) return null
    return (await this.control.one<TenantRow>('SELECT * FROM cloud_tenants WHERE slug = $1', [slug])) ?? null
  }

  async create(input: { name: string; slug?: string; contact?: string; licence_key?: string; licence_number?: string; notes?: string }): Promise<CreatedTenant> {
    const name = String(input?.name ?? '').trim()
    if (name.length < 2) throw new Error('Raison sociale du client obligatoire.')
    let slug = String(input?.slug ?? '').trim().toLowerCase() || slugify(name)
    if (!SLUG.test(slug)) throw new Error('Identifiant invalide : 3 à 31 caractères, lettres minuscules, chiffres et « _ », en commençant par une lettre.')
    if (!input?.slug) {
      // Identifiant déduit du nom : suffixe si déjà pris
      const base = slug.slice(0, 27)
      for (let i = 2; await this.get(slug); i++) slug = `${base}_${i}`
    } else if (await this.get(slug)) throw new Error(`L'identifiant « ${slug} » est déjà utilisé.`)
    const dbName = `iam_${slug}`
    const password = newPassword()
    const setupCode = newSetupCode()
    await this.prov.createDatabase(dbName, password)
    try {
      // Ouverture = création des tables de l'application dans la nouvelle base
      const db = await this.prov.open(dbName, password)
      if (input.licence_key) {
        await db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['licence_key', JSON.stringify(String(input.licence_key).replace(/\s+/g, ''))])
      }
      this.open.set(slug, { db: Promise.resolve(db), used: Date.now(), password })
      await this.control.query(
        `INSERT INTO cloud_tenants (slug, name, db_name, db_user, db_password, setup_code, contact, licence_number, notes) VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8)`,
        [slug, name, dbName, password, setupCode, input.contact?.trim() || null, input.licence_number?.trim() || null, input.notes?.trim() || null]
      )
    } catch (e) {
      await this.close(slug)
      await this.prov.dropDatabase(dbName).catch(() => {})
      throw e
    }
    const { host, port } = this.prov.endpoint()
    return { slug, name, path: `/t/${slug}`, db_name: dbName, db_user: dbName, db_password: password, db_host: host, db_port: port, setup_code: setupCode }
  }

  /** Base du client (ouverte à la demande, partagée entre les requêtes). */
  async db(t: TenantRow): Promise<Db> {
    const hit = this.open.get(t.slug)
    if (hit && hit.password === t.db_password) {
      hit.used = Date.now()
      return hit.db
    }
    if (hit) await this.close(t.slug)
    const db = this.prov.open(t.db_name, t.db_password)
    this.open.set(t.slug, { db, used: Date.now(), password: t.db_password })
    db.catch(() => this.open.delete(t.slug))
    return db
  }

  async setStatus(slug: string, status: 'active' | 'suspended') {
    const t = await this.must(slug)
    await this.control.query('UPDATE cloud_tenants SET status = $2 WHERE slug = $1', [t.slug, status])
    if (status === 'suspended') await this.close(slug)
  }

  /** Nouveau mot de passe de la base (en cas de fuite) : les applications ne sont pas concernées. */
  async resetPassword(slug: string): Promise<{ db_password: string }> {
    const t = await this.must(slug)
    const password = newPassword()
    await this.prov.setPassword(t.db_name, password)
    await this.control.query('UPDATE cloud_tenants SET db_password = $2 WHERE slug = $1', [slug, password])
    await this.close(slug)
    return { db_password: password }
  }

  /** Nouveau code d'activation (utile tant que la société n'est pas configurée). */
  async resetSetupCode(slug: string): Promise<{ setup_code: string }> {
    await this.must(slug)
    const code = newSetupCode()
    await this.control.query('UPDATE cloud_tenants SET setup_code = $2 WHERE slug = $1', [slug, code])
    return { setup_code: code }
  }

  async update(slug: string, patch: { name?: string; contact?: string; licence_number?: string; notes?: string }) {
    await this.must(slug)
    await this.control.query(
      `UPDATE cloud_tenants SET name = COALESCE($2, name), contact = COALESCE($3, contact), licence_number = COALESCE($4, licence_number), notes = COALESCE($5, notes) WHERE slug = $1`,
      [slug, patch.name?.trim() || null, patch.contact ?? null, patch.licence_number ?? null, patch.notes ?? null]
    )
  }

  /** Suppression définitive (base et utilisateur PostgreSQL). Faire une sauvegarde avant. */
  async remove(slug: string) {
    const t = await this.must(slug)
    await this.close(slug)
    await this.prov.dropDatabase(t.db_name)
    await this.control.query('DELETE FROM cloud_tenants WHERE slug = $1', [slug])
  }

  /** Activité de la base : utilisateurs, documents, dernière connexion. */
  async stats(slug: string) {
    const t = await this.must(slug)
    const db = await this.db(t)
    const [u, d, s] = await Promise.all([
      db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM users WHERE active'),
      db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM documents'),
      db.one<{ v: string }>("SELECT value AS v FROM settings WHERE key = 'name'")
    ])
    let company = ''
    try {
      company = s ? JSON.parse(s.v) : ''
    } catch {
      /* raison sociale illisible */
    }
    return { users: u?.n ?? 0, documents: d?.n ?? 0, company, configured: (u?.n ?? 0) > 0, size: await this.prov.databaseSize(t.db_name) }
  }

  async closeAll() {
    clearInterval(this.sweeper)
    await Promise.all([...this.open.keys()].map((s) => this.close(s)))
  }

  private async must(slug: string): Promise<TenantRow> {
    const t = await this.get(slug)
    if (!t) throw new Error(`Client inconnu : ${slug}`)
    return t
  }

  private async close(slug: string) {
    const hit = this.open.get(slug)
    this.open.delete(slug)
    if (hit) await (await hit.db.catch(() => null))?.close().catch(() => {})
  }

  private async sweep() {
    const now = Date.now()
    for (const [slug, h] of this.open) if (now - h.used > this.idleMs) await this.close(slug)
  }
}
