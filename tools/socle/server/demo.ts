// Version de démonstration (base commune des applications IAM : source iam-erp/tools/socle,
// recopiée par sync.mjs ; ne pas modifier ici).
// Chaque visiteur du site obtient, depuis le navigateur seulement, son propre espace de
// démonstration rempli de données fictives : marqué « démo », séparé des comptes réels, exclu des
// statistiques, effacé automatiquement après 24 heures. Les comptes réels ne reçoivent jamais de
// données de démonstration.
//
//   POST /api/socle/demo          nouvel espace de démonstration → { token, expires_at }
//   GET  /api/socle/demo/status   espace de démonstration ? (bandeau de l'interface)
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SocleDb } from './notify'

export interface DemoSeed {
  /** Crée un espace de démonstration rempli ; rend l'utilisateur à connecter. */
  create(): Promise<{ userId: number }>
  /** Supprime les espaces de démonstration créés avant cette date ; rend leur nombre. */
  purge(before: Date): Promise<number>
  /** L'utilisateur appartient-il à un espace de démonstration ? Rend sa date de création. */
  createdAt(userId: number): Promise<Date | null>
}

export interface DemoOptions {
  seed: DemoSeed
  /** Jeton de session de l'application pour cet utilisateur (services/auth.ts : createToken). */
  token: (userId: number) => Promise<string>
  /** Utilisateur d'un jeton (services/auth.ts : resolveToken). */
  resolveUser: (token: string) => Promise<{ id: number } | null | undefined>
  hours?: number
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Limite simple : nombre d'événements par clé sur une fenêtre glissante. */
class Window {
  private hits = new Map<string, number[]>()
  constructor(private max: number, private ms: number) {}
  take(key: string): boolean {
    const now = Date.now()
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.ms)
    if (list.length >= this.max) {
      this.hits.set(key, list)
      return false
    }
    list.push(now)
    this.hits.set(key, list)
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.ms)) this.hits.delete(k)
    return true
  }
}

export class DemoService {
  private perIp = new Window(6, 3600_000)
  private perDay = new Window(400, 24 * 3600_000)
  private hours: number

  constructor(private opts: DemoOptions) {
    this.hours = opts.hours ?? 24
    // Nettoyage : au démarrage puis toutes les heures
    const purge = () => void this.opts.seed.purge(new Date(Date.now() - this.hours * 3600_000)).catch((e) => console.warn('Démonstrations :', e?.message ?? e))
    setTimeout(purge, 20_000).unref?.()
    setInterval(purge, 3600_000).unref?.()
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string, ip: string): Promise<boolean> {
    if (path === '/api/socle/demo' && req.method === 'POST') {
      if (!this.perIp.take(ip) || !this.perDay.take('jour')) {
        json(res, 429, { ok: false, error: 'Trop de démonstrations ouvertes : réessayez dans une heure.' })
        return true
      }
      try {
        const { userId } = await this.opts.seed.create()
        const token = await this.opts.token(userId)
        json(res, 200, { ok: true, data: { token, expires_at: new Date(Date.now() + this.hours * 3600_000).toISOString() } })
      } catch (e: any) {
        console.error('[démonstration]', e)
        json(res, 500, { ok: false, error: 'Démonstration indisponible pour le moment.' })
      }
      return true
    }
    if (path === '/api/socle/demo/status' && req.method === 'GET') {
      const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? ''
      const user = token ? await this.opts.resolveUser(token) : null
      const at = user ? await this.opts.seed.createdAt(user.id) : null
      json(res, 200, { ok: true, data: { demo: !!at, expires_at: at ? new Date(at.getTime() + this.hours * 3600_000).toISOString() : null } })
      return true
    }
    return false
  }
}

interface ForeignKey {
  child: string
  ccols: string[]
  parent: string
  pcols: string[]
  /** a : aucune action, r : interdit, c : en cascade, n : mis à vide, d : valeur par défaut */
  action: string
}

const ident = (name: string) => '"' + name.replace(/"/g, '""') + '"'

async function foreignKeys(db: SocleDb): Promise<ForeignKey[]> {
  return db.query<ForeignKey>(
    `SELECT cl.relname::text AS child, pl.relname::text AS parent, c.confdeltype::text AS action,
       ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n, i) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.i) AS ccols,
       ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n, i) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.i) AS pcols
     FROM pg_constraint c
     JOIN pg_class cl ON cl.oid = c.conrelid
     JOIN pg_class pl ON pl.oid = c.confrelid
     JOIN pg_namespace ns ON ns.oid = cl.relnamespace
     WHERE c.contype = 'f' AND ns.nspname = current_schema()`
  )
}

/**
 * Supprime des lignes (identifiants `ids` de `table`) et tout ce qui en dépend, en suivant les clés
 * étrangères déclarées : les lignes qui les référencent sont supprimées d'abord, à toute profondeur.
 * Les tables qui portent la colonne `spaceColumn` sans clé étrangère sont nettoyées aussi.
 * Réservé aux espaces de démonstration : rien n'atteint une ligne qui ne dépend pas de ces identifiants.
 */
export async function purgeRows(db: SocleDb, table: string, ids: number[], spaceColumn?: string): Promise<void> {
  const list = ids.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n))
  if (!list.length) return
  const fks = await foreignKeys(db)
  const root = `id = ANY('{${list.join(',')}}'::bigint[])`
  const remove = async (t: string, where: string, path: string[]) => {
    if (path.length > 8) throw new Error(`Démonstrations : dépendances trop profondes depuis ${t}`)
    for (const fk of fks) {
      // Mis à vide ou par défaut : la base s'en charge. Référence d'une table à elle-même (dossier
      // parent…) ou boucle entre tables : les lignes partent dans la même instruction plus haut.
      if (fk.parent !== t || fk.action === 'n' || fk.action === 'd' || fk.child === t || path.includes(fk.child)) continue
      const cols = fk.ccols.map(ident).join(', ')
      const refs = fk.pcols.map(ident).join(', ')
      await remove(fk.child, `(${cols}) IN (SELECT ${refs} FROM ${ident(t)} WHERE ${where})`, [...path, t])
    }
    await db.query(`DELETE FROM ${ident(t)} WHERE ${where}`)
  }
  if (spaceColumn) {
    const loose = await db.query<{ t: string }>(
      `SELECT c.table_name::text AS t FROM information_schema.columns c
       WHERE c.table_schema = current_schema() AND c.column_name = $1 AND c.table_name <> $2
         AND EXISTS (SELECT 1 FROM information_schema.tables x WHERE x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE')`,
      [spaceColumn, table]
    )
    // Premier passage sans s'arrêter (une ligne encore référencée part avec l'espace lui-même)
    for (const { t } of loose) await remove(t, `${ident(spaceColumn)} = ANY('{${list.join(',')}}'::bigint[])`, [table]).catch(() => {})
  }
  await remove(table, root, [])
}

/**
 * Démonstration d'une application à espaces (entreprises, écoles, organisations…) : `create` ouvre un
 * espace marqué demo = TRUE et rend son administrateur ; nettoyage et reconnaissance sont communs.
 */
export function spaceDemo(o: { db: SocleDb; create: () => Promise<{ userId: number }>; spaces?: string; userSpace?: string }): DemoSeed {
  const spaces = o.spaces ?? 'companies'
  const col = o.userSpace ?? (spaces === 'orgs' ? 'org_id' : 'company_id')
  return {
    create: o.create,
    async purge(before) {
      const rows = await o.db.query<{ id: number }>(`SELECT id FROM ${ident(spaces)} WHERE demo AND created_at < $1`, [before])
      for (const r of rows) await purgeRows(o.db, spaces, [r.id], col)
      return rows.length
    },
    async createdAt(userId) {
      const r = await o.db.one<{ at: string | Date }>(`SELECT c.created_at AS at FROM users u JOIN ${ident(spaces)} c ON c.id = u.${ident(col)} WHERE u.id = $1 AND c.demo`, [userId])
      return r ? new Date(r.at) : null
    }
  }
}

/** Démonstration d'une application sans espaces (un compte = un utilisateur) : users.demo = TRUE. */
export function userDemo(o: { db: SocleDb; create: () => Promise<{ userId: number }> }): DemoSeed {
  return {
    create: o.create,
    async purge(before) {
      const rows = await o.db.query<{ id: number }>('SELECT id FROM users WHERE demo AND created_at < $1', [before])
      for (const r of rows) await purgeRows(o.db, 'users', [r.id], 'user_id')
      return rows.length
    },
    async createdAt(userId) {
      const r = await o.db.one<{ at: string | Date }>('SELECT created_at AS at FROM users WHERE id = $1 AND demo', [userId])
      return r ? new Date(r.at) : null
    }
  }
}
