// Instantané complet d'une base : toutes les tables, lues puis réécrites telles quelles dans
// une autre base de même version. Sert à remonter la base du serveur de l'entreprise vers sa
// copie en ligne (voir mirror.ts). Indépendant du moteur : PGlite du poste ou PostgreSQL.
//
// L'import remplace tout le contenu en une seule transaction. Les sessions ouvertes sur la
// base de destination sont conservées (les personnes qui consultent la copie restent connectées).

import type { Db } from './db'
import { MIGRATIONS } from './schema'

export interface Snapshot {
  /** Version du schéma (nombre de migrations) : l'import exige la même. */
  schema: number
  taken_at: string
  tables: Record<string, Record<string, unknown>[]>
}

/** Propres à chaque base : jamais copiées. */
const SKIP = new Set(['schema_version', 'auth_sessions', 'client_ops'])

interface Column { name: string; type: string; nullable: boolean; serial: boolean }
interface Fk { table: string; column: string; parent: string }

async function describe(db: Db) {
  const tables = (await db.query<{ t: string }>("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"))
    .map((r) => r.t)
    .filter((t) => !SKIP.has(t))
  const cols = await db.query<{ t: string; c: string; d: string; n: string; def: string | null }>(
    "SELECT table_name AS t, column_name AS c, data_type AS d, is_nullable AS n, column_default AS def FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position"
  )
  const columns = new Map<string, Column[]>()
  for (const r of cols) {
    if (!tables.includes(r.t)) continue
    const list = columns.get(r.t) ?? []
    list.push({ name: r.c, type: r.d, nullable: r.n === 'YES', serial: /^nextval\(/.test(r.def ?? '') })
    columns.set(r.t, list)
  }
  const fks = (
    await db.query<Fk>(
      `SELECT kcu.table_name AS "table", kcu.column_name AS "column", ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`
    )
  ).filter((f) => tables.includes(f.table) && tables.includes(f.parent))
  const pks = await db.query<{ t: string; c: string }>(
    `SELECT kcu.table_name AS t, kcu.column_name AS c FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' ORDER BY kcu.ordinal_position`
  )
  const pk = new Map<string, string[]>()
  for (const r of pks) pk.set(r.t, [...(pk.get(r.t) ?? []), r.c])
  return { tables, columns, fks, pk }
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`

export async function exportSnapshot(db: Db): Promise<Snapshot> {
  const { tables, pk } = await describe(db)
  const out: Snapshot['tables'] = {}
  // Une seule transaction : toutes les tables au même instant
  await db.tx(async (t) => {
    for (const name of tables) {
      const order = pk.get(name)?.map(q).join(', ')
      out[name] = await t.query(`SELECT * FROM ${q(name)}${order ? ` ORDER BY ${order}` : ''}`)
    }
  })
  // Passage par JSON : dates en texte ISO, mêmes valeurs quel que soit le moteur
  return JSON.parse(JSON.stringify({ schema: MIGRATIONS.length, taken_at: new Date().toISOString(), tables: out }))
}

/**
 * Ordre d'insertion respectant les clés étrangères. Les références d'une table vers elle-même
 * et celles qui formeraient une boucle sont « différées » : la colonne est insérée vide puis
 * renseignée une fois toutes les lignes en place (possible seulement si elle accepte le vide).
 */
function plan(tables: string[], fks: Fk[], columns: Map<string, Column[]>) {
  const nullable = (f: Fk) => !!columns.get(f.table)?.find((c) => c.name === f.column)?.nullable
  const deferred: Fk[] = fks.filter((f) => f.table === f.parent)
  let edges = fks.filter((f) => f.table !== f.parent)
  const order: string[] = []
  const left = new Set(tables)
  while (left.size) {
    const ready = [...left].filter((t) => !edges.some((e) => e.table === t && left.has(e.parent)))
    if (ready.length) {
      for (const t of ready.sort()) {
        order.push(t)
        left.delete(t)
      }
      continue
    }
    // Boucle : on diffère une référence facultative entre tables restantes
    const cut = edges.find((e) => left.has(e.table) && left.has(e.parent) && nullable(e))
    if (!cut) throw new Error(`Instantané impossible : références circulaires obligatoires entre ${[...left].join(', ')}.`)
    deferred.push(cut)
    edges = edges.filter((e) => e !== cut)
  }
  for (const f of deferred) if (!nullable(f)) throw new Error(`Instantané impossible : ${f.table}.${f.column} se référence et n'accepte pas le vide.`)
  return { order, deferred }
}

const encode = (col: Column, v: unknown) => (v === null || v === undefined ? null : /json/.test(col.type) ? JSON.stringify(v) : v)

export async function importSnapshot(db: Db, snap: Snapshot): Promise<{ tables: number; rows: number }> {
  if (!snap || typeof snap !== 'object' || !snap.tables) throw new Error('Instantané illisible.')
  if (snap.schema !== MIGRATIONS.length)
    throw new Error(`Versions différentes : l'instantané vient d'une version ${snap.schema < MIGRATIONS.length ? 'plus ancienne' : 'plus récente'} du logiciel. Mettez les deux serveurs à la même version.`)
  const { tables, columns, fks, pk } = await describe(db)
  const unknown = Object.keys(snap.tables).filter((t) => !tables.includes(t))
  if (unknown.length) throw new Error(`Instantané illisible : table inconnue ${unknown.join(', ')}.`)
  const { order, deferred } = plan(tables, fks, columns)
  let rows = 0

  await db.tx(async (t) => {
    // Sessions de la base de destination : remises en place après le remplacement
    const sessions = await t.query<Record<string, unknown>>('SELECT * FROM auth_sessions')
    await t.query(`TRUNCATE ${tables.map(q).join(', ')} RESTART IDENTITY CASCADE`)

    for (const name of order) {
      const data = snap.tables[name] ?? []
      if (!data.length) continue
      const cols = columns.get(name)!.filter((c) => c.name in data[0])
      const later = new Set(deferred.filter((f) => f.table === name).map((f) => f.column))
      const cast = (c: Column) => (/json/.test(c.type) ? `::${c.type}` : '')
      // Par paquets : une requête par ligne serait trop lente, une seule dépasserait la limite de paramètres
      const size = Math.max(1, Math.floor(1000 / cols.length))
      for (let i = 0; i < data.length; i += size) {
        const chunk = data.slice(i, i + size)
        const params: unknown[] = []
        const values = chunk.map((row) => `(${cols.map((c) => (params.push(later.has(c.name) ? null : encode(c, row[c.name])), `$${params.length}${cast(c)}`)).join(', ')})`)
        await t.query(`INSERT INTO ${q(name)} (${cols.map((c) => q(c.name)).join(', ')}) VALUES ${values.join(', ')}`, params)
      }
      rows += data.length
    }

    // Références différées
    for (const f of deferred) {
      const keys = pk.get(f.table)
      if (!keys?.length) throw new Error(`Instantané impossible : ${f.table} n'a pas de clé primaire.`)
      for (const row of snap.tables[f.table] ?? []) {
        if (row[f.column] === null || row[f.column] === undefined) continue
        await t.query(`UPDATE ${q(f.table)} SET ${q(f.column)} = $1 WHERE ${keys.map((k, i) => `${q(k)} = $${i + 2}`).join(' AND ')}`, [row[f.column], ...keys.map((k) => row[k])])
      }
    }

    // Compteurs des identifiants : repris après le plus grand identifiant importé
    for (const name of order) {
      for (const c of columns.get(name)!.filter((x) => x.serial)) {
        await t.query(`SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${q(c.name)}) FROM ${q(name)}), 1), (SELECT MAX(${q(c.name)}) FROM ${q(name)}) IS NOT NULL)`, [name, c.name])
      }
    }

    for (const s of sessions) {
      if (!(await t.one('SELECT 1 FROM users WHERE id = $1 AND active', [s.user_id]))) continue
      const keys = Object.keys(s)
      await t.query(`INSERT INTO auth_sessions (${keys.map(q).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT DO NOTHING`, keys.map((k) => s[k]))
    }
  })
  return { tables: order.length, rows }
}
