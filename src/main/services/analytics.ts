// Moteur d'analyses : traduit une analyse (jeu de données, mesures, regroupements, période,
// filtres) en SQL paramétré, puis calcule comparaison, tableau croisé, prévision et faits
// marquants. Les identifiants SQL viennent uniquement des tables ci-dessous (jamais de
// l'utilisateur) ; les valeurs passent toujours en paramètres.

import { can, type Module } from '@shared/domain'
import {
  DATASETS, findDataset, type AlertRule, type AnalysisConfig, type AnalysisResult, type AnalysisRow, type Compare,
  type DatasetDef, type Insight, type TimeGrain
} from '@shared/analytics'
import { formatMoney, formatNumber, todayISO } from '@shared/format'
import { licenceStatus } from './licence'
import { audit, fail, str, type Ctx } from './context'

interface SqlDataset {
  from: string
  /** Colonne de date (texte AAAA-MM-JJ) ; absente pour une photographie. */
  date: string | null
  dims: Record<string, string>
  measures: Record<string, string>
}

const SIGN = "(CASE WHEN d.type = 'AV' THEN -1 ELSE 1 END)"
const COST = 'COALESCE(NULLIF(pr.avg_cost, 0), pr.purchase_price, 0)'
const DOW = (x: string) => `extract(isodow from (${x})::date)::int::text`

/** Expression SQL de chaque jeu de données. $TODAY est remplacé par un paramètre. */
const SQL: Record<string, SqlDataset> = {
  ventes: {
    from: `FROM document_lines l
      JOIN documents d ON d.id = l.document_id
      LEFT JOIN parties p ON p.id = d.party_id
      LEFT JOIN products pr ON pr.id = l.product_id
      LEFT JOIN users u ON u.id = d.created_by
      LEFT JOIN projects pj ON pj.id = d.project_id
      LEFT JOIN warehouses w ON w.id = d.warehouse_id
      WHERE d.status = 'valide' AND d.type IN ('FAC','AV')`,
    date: 'd.date',
    dims: {
      client: 'COALESCE(p.name, \'—\')',
      ville: "COALESCE(NULLIF(p.city, ''), 'Non renseignée')",
      article: 'COALESCE(pr.name, l.description)',
      categorie: "COALESCE(NULLIF(pr.category, ''), 'Sans catégorie')",
      type_article: "CASE WHEN pr.kind = 'prestation' THEN 'Prestations' WHEN pr.kind = 'produit' THEN 'Produits' ELSE 'Lignes libres' END",
      commercial: "COALESCE(u.full_name, 'Non renseigné')",
      projet: "COALESCE(pj.name, 'Hors projet')",
      depot: "COALESCE(w.name, 'Dépôt principal')",
      jour_semaine: DOW('d.date')
    },
    measures: {
      ca_ht: `SUM(${SIGN} * l.total_ht)`,
      marge: `SUM(${SIGN} * (l.total_ht - l.quantity * ${COST}))`,
      taux_marge: `CASE WHEN SUM(${SIGN} * l.total_ht) = 0 THEN NULL ELSE SUM(${SIGN} * (l.total_ht - l.quantity * ${COST})) * 100.0 / SUM(${SIGN} * l.total_ht) END`,
      quantite: `SUM(${SIGN} * l.quantity)`,
      documents: "COUNT(DISTINCT CASE WHEN d.type = 'FAC' THEN d.id END)",
      panier: `SUM(${SIGN} * l.total_ht) / NULLIF(COUNT(DISTINCT CASE WHEN d.type = 'FAC' THEN d.id END), 0)`,
      clients: 'COUNT(DISTINCT d.party_id)'
    }
  },
  achats: {
    from: `FROM document_lines l
      JOIN documents d ON d.id = l.document_id
      LEFT JOIN parties p ON p.id = d.party_id
      LEFT JOIN products pr ON pr.id = l.product_id
      LEFT JOIN projects pj ON pj.id = d.project_id
      WHERE d.status = 'valide' AND d.type = 'FF'`,
    date: 'd.date',
    dims: {
      fournisseur: 'COALESCE(p.name, \'—\')',
      article: 'COALESCE(pr.name, l.description)',
      categorie: "COALESCE(NULLIF(pr.category, ''), 'Sans catégorie')",
      ville: "COALESCE(NULLIF(p.city, ''), 'Non renseignée')",
      projet: "COALESCE(pj.name, 'Hors projet')"
    },
    measures: {
      montant_ht: 'SUM(l.total_ht)',
      quantite: 'SUM(l.quantity)',
      documents: 'COUNT(DISTINCT d.id)',
      fournisseurs: 'COUNT(DISTINCT d.party_id)',
      prix_moyen: 'SUM(l.total_ht) / NULLIF(SUM(l.quantity), 0)'
    }
  },
  tresorerie: {
    from: `FROM payments py
      LEFT JOIN parties pa ON pa.id = py.party_id
      LEFT JOIN users u ON u.id = py.user_id
      WHERE TRUE`,
    date: 'py.date',
    dims: {
      mode: "COALESCE(NULLIF(py.method, ''), 'Autre')",
      sens: "CASE WHEN py.direction = 'in' THEN 'Encaissements' ELSE 'Décaissements' END",
      tiers: "COALESCE(pa.name, '—')",
      utilisateur: "COALESCE(u.full_name, 'Non renseigné')"
    },
    measures: {
      entrees: "SUM(CASE WHEN py.direction = 'in' THEN py.amount ELSE 0 END)",
      sorties: "SUM(CASE WHEN py.direction = 'out' THEN py.amount ELSE 0 END)",
      solde: "SUM(CASE WHEN py.direction = 'in' THEN py.amount ELSE -py.amount END)",
      operations: 'COUNT(*)'
    }
  },
  creances: {
    from: `FROM (
        SELECT d.*, d.total_ttc - COALESCE((SELECT SUM(amount) FROM payments WHERE document_id = d.id), 0) AS reste
        FROM documents d WHERE d.status = 'valide' AND d.type = 'FAC'
      ) d
      LEFT JOIN parties p ON p.id = d.party_id
      LEFT JOIN users u ON u.id = d.created_by
      WHERE d.reste > 0.5`,
    date: 'd.date',
    dims: {
      anciennete: `CASE WHEN d.due_date IS NULL OR d.due_date >= $TODAY THEN '0'
        WHEN ($TODAY::date - d.due_date::date) <= 30 THEN '1'
        WHEN ($TODAY::date - d.due_date::date) <= 60 THEN '2'
        WHEN ($TODAY::date - d.due_date::date) <= 90 THEN '3' ELSE '4' END`,
      client: "COALESCE(p.name, '—')",
      ville: "COALESCE(NULLIF(p.city, ''), 'Non renseignée')",
      commercial: "COALESCE(u.full_name, 'Non renseigné')"
    },
    measures: {
      reste_du: 'SUM(d.reste)',
      factures: 'COUNT(*)',
      retard_moyen: 'AVG(GREATEST(0, $TODAY::date - COALESCE(d.due_date, d.date)::date))',
      clients: 'COUNT(DISTINCT d.party_id)'
    }
  },
  stock: {
    from: "FROM products pr WHERE pr.kind = 'produit' AND pr.active",
    date: null,
    dims: {
      categorie: "COALESCE(NULLIF(pr.category, ''), 'Sans catégorie')",
      article: 'pr.name',
      alerte: "CASE WHEN pr.stock_qty <= 0 THEN 'Rupture' WHEN pr.stock_qty <= pr.min_stock THEN 'Sous le seuil' ELSE 'Suffisant' END"
    },
    measures: {
      valeur: 'SUM(GREATEST(pr.stock_qty, 0) * pr.avg_cost)',
      valeur_vente: 'SUM(GREATEST(pr.stock_qty, 0) * pr.sale_price)',
      quantite: 'SUM(pr.stock_qty)',
      articles: 'COUNT(*)',
      sous_seuil: 'SUM(CASE WHEN pr.stock_qty <= pr.min_stock THEN 1 ELSE 0 END)'
    }
  },
  caisse: {
    from: `FROM documents d
      JOIN (SELECT DISTINCT document_id, cash_session_id FROM payments WHERE cash_session_id IS NOT NULL AND document_id IS NOT NULL) cp ON cp.document_id = d.id
      JOIN cash_sessions cs ON cs.id = cp.cash_session_id
      LEFT JOIN users u ON u.id = cs.user_id
      WHERE d.status = 'valide' AND d.type = 'FAC'`,
    date: 'd.date',
    dims: {
      caissier: "COALESCE(u.full_name, '—')",
      heure: "to_char(d.created_at, 'HH24')",
      jour_semaine: DOW('d.date')
    },
    measures: {
      ca_ttc: 'SUM(d.total_ttc)',
      tickets: 'COUNT(DISTINCT d.id)',
      ticket_moyen: 'SUM(d.total_ttc) / NULLIF(COUNT(DISTINCT d.id), 0)'
    }
  }
}

const GRAIN_SQL: Record<TimeGrain, (x: string) => string> = {
  jour: (x) => x,
  semaine: (x) => `to_char((${x})::date, 'IYYY-"S"IW')`,
  mois: (x) => `substr(${x}, 1, 7)`,
  trimestre: (x) => `substr(${x}, 1, 4) || '-T' || ((substr(${x}, 6, 2)::int + 2) / 3)::text`,
  annee: (x) => `substr(${x}, 1, 4)`
}

// ── Périodes ────────────────────────────────────────────────────────────────────────

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const DAYS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
const AGES = ['Non échues', '1 à 30 jours', '31 à 60 jours', '61 à 90 jours', 'Plus de 90 jours']

const d2s = (d: Date) => d.toISOString().slice(0, 10)
const s2d = (s: string) => new Date(s + 'T12:00:00Z')
const addDays = (s: string, n: number) => {
  const d = s2d(s)
  d.setUTCDate(d.getUTCDate() + n)
  return d2s(d)
}
const shiftYear = (s: string, n: number) => {
  const d = s2d(s)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCFullYear(d.getUTCFullYear() + n)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d2s(d)
}
function isoWeek(s: string): string {
  const d = s2d(s)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const year = d.getUTCFullYear()
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)
  return `${year}-S${String(week).padStart(2, '0')}`
}
export function periodKey(date: string, grain: TimeGrain): string {
  switch (grain) {
    case 'jour': return date
    case 'semaine': return isoWeek(date)
    case 'mois': return date.slice(0, 7)
    case 'trimestre': return `${date.slice(0, 4)}-T${Math.floor((Number(date.slice(5, 7)) + 2) / 3)}`
    case 'annee': return date.slice(0, 4)
  }
}
export function periodLabel(key: string, grain: TimeGrain): string {
  switch (grain) {
    case 'jour': return `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`
    case 'semaine': return `Sem. ${Number(key.slice(6))} ${key.slice(0, 4)}`
    case 'mois': return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`
    case 'trimestre': return `${key.slice(5)} ${key.slice(0, 4)}`
    case 'annee': return key
  }
}
/** Toutes les périodes d'un intervalle, dans l'ordre (les périodes sans données valent 0). */
export function periodKeys(from: string, to: string, grain: TimeGrain): string[] {
  const out: string[] = []
  const step = grain === 'jour' ? 1 : grain === 'semaine' ? 7 : 28
  let cur = from
  for (let guard = 0; cur <= to && guard < 2000; guard++) {
    const k = periodKey(cur, grain)
    if (out[out.length - 1] !== k) out.push(k)
    cur = addDays(cur, step)
  }
  const last = periodKey(to, grain)
  if (out[out.length - 1] !== last) out.push(last)
  return out
}
function nextKey(key: string, grain: TimeGrain): string {
  switch (grain) {
    case 'jour': return addDays(key, 1)
    case 'semaine': {
      // Lundi de la semaine ISO puis +7 jours
      const [y, w] = [Number(key.slice(0, 4)), Number(key.slice(6))]
      const jan4 = new Date(Date.UTC(y, 0, 4))
      const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000 + (w - 1) * 7 * 86400000)
      return isoWeek(addDays(d2s(monday), 7))
    }
    case 'mois': {
      const [y, m] = [Number(key.slice(0, 4)), Number(key.slice(5, 7))]
      return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    }
    case 'trimestre': {
      const [y, q] = [Number(key.slice(0, 4)), Number(key.slice(6))]
      return q === 4 ? `${y + 1}-T1` : `${y}-T${q + 1}`
    }
    case 'annee': return String(Number(key) + 1)
  }
}

export function compareRange(from: string, to: string, mode: Compare): [string, string] | null {
  if (mode === 'year') return [shiftYear(from, -1), shiftYear(to, -1)]
  if (mode === 'previous') {
    const len = Math.round((s2d(to).getTime() - s2d(from).getTime()) / 86400000) + 1
    const prevTo = addDays(from, -1)
    return [addDays(prevTo, -(len - 1)), prevTo]
  }
  return null
}

function dimLabel(dim: string, key: string, grain: TimeGrain): string {
  if (dim === 'periode') return periodLabel(key, grain)
  if (dim === 'jour_semaine') return DAYS[Number(key)] ?? key
  if (dim === 'anciennete') return AGES[Number(key)] ?? key
  if (dim === 'heure') return `${key} h`
  return key
}

// ── Exécution ───────────────────────────────────────────────────────────────────────

/** Jeux de données accessibles : droits du rôle et modules de la licence. */
async function allowedDatasets(ctx: Ctx): Promise<DatasetDef[]> {
  const st = await licenceStatus(ctx.db)
  return DATASETS.filter((d) => ctx.user && can(ctx.user.role, d.module) && st.modules.includes(d.module as Module))
}

export async function catalog(ctx: Ctx) {
  return allowedDatasets(ctx)
}

interface Built { sql: string; params: unknown[] }

function build(ds: DatasetDef, cfg: AnalysisConfig, range: [string, string] | null, groups: string[], today: string, limit?: number): Built {
  const q = SQL[ds.id]
  const params: unknown[] = []
  const p = (v: unknown) => `$${params.push(v)}`
  // Paramètre « aujourd'hui » ajouté seulement s'il sert (PostgreSQL refuse un paramètre inutilisé)
  let todayP: string | null = null
  const fix = (s: string) => (s.includes('$TODAY') ? s.split('$TODAY').join((todayP ??= p(today))) : s)
  const grain = cfg.grain ?? 'mois'
  const dimExpr = (dim: string) => (dim === 'periode' ? GRAIN_SQL[grain](q.date!) : fix(q.dims[dim]))
  const selects = groups.map((g, i) => `${dimExpr(g)} AS g${i}`)
  for (const m of cfg.measures) selects.push(`(${fix(q.measures[m])})::float8 AS "${m}"`)
  let where = fix(q.from)
  if (range && q.date) where += ` AND ${q.date} BETWEEN ${p(range[0])} AND ${p(range[1])}`
  for (const [dim, values] of Object.entries(cfg.filters ?? {})) {
    if (!values?.length || dim === 'periode' || !(dim in q.dims)) continue
    where += ` AND ${dimExpr(dim)} IN (${values.slice(0, 200).map((v) => p(String(v))).join(', ')})`
  }
  let sql = `SELECT ${selects.join(', ')} ${where}`
  if (groups.length) sql += ` GROUP BY ${groups.map((_, i) => i + 1).join(', ')}`
  if (groups.length && limit) sql += ` ORDER BY ${groups.length + 1} DESC NULLS LAST LIMIT ${limit}`
  return { sql, params }
}

function validate(ds: DatasetDef | undefined, cfg: AnalysisConfig): asserts ds is DatasetDef {
  if (!ds) fail('Jeu de données inconnu.')
  if (!Array.isArray(cfg.measures) || !cfg.measures.length) fail('Choisissez au moins une mesure.')
  for (const m of cfg.measures) if (!ds.measures.some((x) => x.id === m)) fail(`Mesure inconnue : ${m}`)
  for (const d of [cfg.rows, cfg.columns]) if (d && !ds.dimensions.some((x) => x.id === d)) fail(`Regroupement inconnu : ${d}`)
  if (cfg.rows && cfg.rows === cfg.columns) fail('Les lignes et les colonnes doivent être deux regroupements différents.')
  for (const d of [cfg.from, cfg.to]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail('Période invalide.')
}

const MAX_ROWS = 1000

export async function runAnalysis(ctx: Ctx, input: AnalysisConfig, today = todayISO()): Promise<AnalysisResult> {
  const cfg: AnalysisConfig = { ...input, measures: (input?.measures ?? []).slice(0, 6) }
  const ds = (await allowedDatasets(ctx)).find((d) => d.id === cfg.dataset)
  if (!ds && findDataset(cfg.dataset)) fail("Vous n'avez pas accès à ce jeu de données.")
  validate(ds, cfg)
  const q = SQL[ds.id]
  const grain = cfg.grain ?? 'mois'
  const snapshot = !!ds.snapshot || !q.date
  const from = snapshot ? (cfg.rows === 'periode' && cfg.from ? cfg.from : null) : cfg.from ?? `${today.slice(0, 4)}-01-01`
  const to = snapshot ? (cfg.rows === 'periode' && cfg.to ? cfg.to : null) : cfg.to ?? today
  if (from && to && from > to) fail('La date de début doit précéder la date de fin.')
  const range: [string, string] | null = from && to ? [from, to] : null
  const cmp = !snapshot && range && cfg.compare && cfg.compare !== 'none' ? compareRange(range[0], range[1], cfg.compare) : null
  const first = cfg.measures[0]
  const mdef = (id: string) => ds.measures.find((m) => m.id === id)!
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  const vals = (r: any) => Object.fromEntries(cfg.measures.map((m) => [m, num(r[m])]))

  // Totaux (exacts même pour les mesures non additives)
  const totalQ = build(ds, cfg, range, [], today)
  const totalRow = (await ctx.db.query(totalQ.sql, totalQ.params))[0] ?? {}
  const totals = vals(totalRow)
  let compareTotals: Record<string, number | null> | null = null
  if (cmp) {
    const c = build(ds, cfg, cmp, [], today)
    compareTotals = vals((await ctx.db.query(c.sql, c.params))[0] ?? {})
  }

  let rows: AnalysisRow[] = []
  let truncated = false
  const isTime = cfg.rows === 'periode'
  if (cfg.rows) {
    const b = build(ds, cfg, range, [cfg.rows], today, isTime ? undefined : MAX_ROWS + 1)
    const raw = await ctx.db.query(b.sql, b.params)
    truncated = raw.length > MAX_ROWS
    const byKey = new Map(raw.slice(0, MAX_ROWS).map((r: any) => [String(r.g0 ?? '—'), r]))
    const keys = isTime && range ? periodKeys(range[0], range[1], grain) : [...byKey.keys()]
    rows = keys.map((k) => ({ key: k, label: dimLabel(cfg.rows!, k, grain), values: byKey.has(k) ? vals(byKey.get(k)) : Object.fromEntries(cfg.measures.map((m) => [m, mdef(m).additive ? 0 : null])) }))
    if (isTime && !range) rows.sort((a, b) => a.key.localeCompare(b.key))

    if (cmp) {
      const c = build(ds, cfg, cmp, [cfg.rows], today)
      const craw = await ctx.db.query(c.sql, c.params)
      const cmap = new Map(craw.map((r: any) => [String(r.g0 ?? '—'), r]))
      if (isTime) {
        // Alignement par rang : 1re période comparée à la 1re période de l'intervalle de comparaison
        const ckeys = periodKeys(cmp[0], cmp[1], grain)
        rows.forEach((r, i) => { const k = ckeys[i]; r.compare = k && cmap.has(k) ? vals(cmap.get(k)) : Object.fromEntries(cfg.measures.map((m) => [m, 0])) })
      } else rows.forEach((r) => { r.compare = cmap.has(r.key) ? vals(cmap.get(r.key)) : Object.fromEntries(cfg.measures.map((m) => [m, 0])) })
    }

    // Tri et regroupement « Autres »
    if (!isTime) {
      if (cfg.sort === 'label' || ['jour_semaine', 'anciennete', 'heure'].includes(cfg.rows)) rows.sort((a, b) => a.key.localeCompare(b.key, 'fr', { numeric: true }))
      else rows.sort((a, b) => (b.values[first] ?? -Infinity) - (a.values[first] ?? -Infinity))
      const top = Math.max(1, Math.min(Number(cfg.top) || 0, 200))
      if (cfg.top && rows.length > top + 1) {
        const rest = rows.slice(top)
        const sum = (get: (r: AnalysisRow) => Record<string, number | null> | undefined) =>
          Object.fromEntries(cfg.measures.map((m) => [m, mdef(m).additive ? rest.reduce((s, r) => s + (get(r)?.[m] ?? 0), 0) : null]))
        rows = [...rows.slice(0, top), { key: '__autres', label: `Autres (${rest.length})`, values: sum((r) => r.values), ...(cmp ? { compare: sum((r) => r.compare) } : {}) }]
      }
    }
  }

  // Tableau croisé : première mesure, colonnes = 8 premières valeurs + « Autres »
  let columns: string[] = []
  if (cfg.rows && cfg.columns) {
    const b = build(ds, { ...cfg, measures: [first] }, range, [cfg.rows, cfg.columns], today)
    const raw = await ctx.db.query(b.sql, b.params)
    const colTotals = new Map<string, number>()
    for (const r of raw as any[]) colTotals.set(String(r.g1 ?? '—'), (colTotals.get(String(r.g1 ?? '—')) ?? 0) + (Number(r[first]) || 0))
    const ordered = [...colTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
    const keep = new Set(ordered.slice(0, 8))
    const others = ordered.length > 8 && mdef(first).additive
    columns = [...ordered.slice(0, 8).map((k) => dimLabel(cfg.columns!, k, grain)), ...(others ? ['Autres'] : [])]
    const rowIndex = new Map(rows.map((r) => [r.key, r]))
    for (const r of raw as any[]) {
      const rk = String(r.g0 ?? '—')
      const ck = String(r.g1 ?? '—')
      const row = rowIndex.get(rk) ?? (rows.find((x) => x.key === '__autres') as AnalysisRow | undefined)
      if (!row) continue
      const col = keep.has(ck) ? dimLabel(cfg.columns, ck, grain) : others ? 'Autres' : null
      if (!col) continue
      row.cells ??= {}
      row.cells[col] = (row.cells[col] ?? 0) + (Number(r[first]) || 0)
    }
  }

  const forecast = isTime && range ? makeForecast(rows, first, grain, to!, today) : []
  const insights = makeInsights(ds, cfg, rows, totals, compareTotals, forecast)
  return { dataset: ds.id, from, to, compareFrom: cmp?.[0] ?? null, compareTo: cmp?.[1] ?? null, rows, columns, totals, compareTotals, forecast, insights, truncated }
}

/** Prévision des 3 prochaines périodes : droite des moindres carrés sur les périodes complètes. */
function makeForecast(rows: AnalysisRow[], measure: string, grain: TimeGrain, to: string, today: string) {
  if (!['jour', 'semaine', 'mois', 'trimestre'].includes(grain)) return []
  // La période en cours n'est pas complète : elle n'entre pas dans le calcul
  const complete = to >= today && rows.length && rows[rows.length - 1].key === periodKey(today, grain) ? rows.slice(0, -1) : rows
  const pts = complete.slice(-12).map((r) => r.values[measure] ?? 0)
  if (pts.length < 4 || pts.every((v) => v === 0)) return []
  const n = pts.length
  const mx = (n - 1) / 2
  const my = pts.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  pts.forEach((v, i) => { sxy += (i - mx) * (v - my); sxx += (i - mx) ** 2 })
  const slope = sxx ? sxy / sxx : 0
  const out: { key: string; label: string; value: number }[] = []
  let key = complete[complete.length - 1].key
  const startIndex = rows.length - complete.length
  for (let i = 0; i < 3; i++) {
    key = nextKey(key, grain)
    const x = n + i + startIndex
    out.push({ key, label: periodLabel(key, grain), value: Math.max(0, Math.round(my + slope * (x - mx))) })
  }
  return out
}

const pct = (a: number, b: number) => (b ? ((a - b) / Math.abs(b)) * 100 : null)
const fmt = (v: number | null, f: string) => (v === null ? '—' : f === 'money' ? formatMoney(v) : f === 'percent' ? `${formatNumber(v, 1)} %` : f === 'days' ? `${formatNumber(v, 0)} j` : formatNumber(v, f === 'number' ? 2 : 0))

/** Faits marquants rédigés à partir des chiffres. */
function makeInsights(ds: DatasetDef, cfg: AnalysisConfig, rows: AnalysisRow[], totals: Record<string, number | null>, cmpTotals: Record<string, number | null> | null, forecast: { label: string; value: number }[]): Insight[] {
  const out: Insight[] = []
  const first = cfg.measures[0]
  const m = ds.measures.find((x) => x.id === first)!
  const cmpLabel = cfg.compare === 'year' ? 'l’an dernier' : 'la période précédente'
  if (cmpTotals) {
    for (const id of cfg.measures.slice(0, 2)) {
      const d = ds.measures.find((x) => x.id === id)!
      const a = totals[id]
      const b = cmpTotals[id]
      if (a === null || b === null) continue
      const p = pct(a, b)
      if (p === null || Math.abs(p) < 0.5) continue
      const bad = id === 'sorties' || id === 'retard_moyen' || id === 'reste_du' ? p > 0 : p < 0
      out.push({ tone: bad ? 'bad' : 'good', text: `${d.label} : ${fmt(a, d.format)}, ${p > 0 ? '+' : ''}${formatNumber(p, 1)} % par rapport à ${cmpLabel} (${fmt(b, d.format)}).` })
    }
  }
  const real = rows.filter((r) => r.key !== '__autres')
  if (cfg.rows === 'periode' && real.length >= 3) {
    const withVal = real.filter((r) => r.values[first] !== null)
    const best = withVal.reduce((a, b) => ((b.values[first] ?? 0) > (a.values[first] ?? 0) ? b : a), withVal[0])
    const worst = withVal.reduce((a, b) => ((b.values[first] ?? 0) < (a.values[first] ?? 0) ? b : a), withVal[0])
    if (best && worst && best !== worst) out.push({ tone: 'info', text: `Meilleure période : ${best.label} (${fmt(best.values[first], m.format)}) ; la plus faible : ${worst.label} (${fmt(worst.values[first], m.format)}).` })
    if (forecast.length) out.push({ tone: 'info', text: `Prévision (tendance des dernières périodes) : ${forecast.map((f) => `${f.label} ≈ ${fmt(f.value, m.format)}`).join(', ')}.` })
  } else if (cfg.rows && m.additive && real.length >= 4 && (totals[first] ?? 0) > 0) {
    const share = (real.slice(0, 3).reduce((s, r) => s + (r.values[first] ?? 0), 0) / (totals[first] ?? 1)) * 100
    const dim = ds.dimensions.find((x) => x.id === cfg.rows)!.label.toLowerCase()
    if (share >= 50) out.push({ tone: share >= 75 ? 'bad' : 'info', text: `Concentration : les 3 premiers (${dim}) représentent ${formatNumber(share, 0)} % du total${share >= 75 ? ' ; attention à la dépendance.' : '.'}` })
    if (cmpTotals) {
      const moves = real.filter((r) => r.compare).map((r) => ({ r, d: (r.values[first] ?? 0) - (r.compare![first] ?? 0) })).sort((a, b) => b.d - a.d)
      const up = moves[0]
      const down = moves[moves.length - 1]
      if (up && up.d > 0) out.push({ tone: 'good', text: `Plus forte progression : ${up.r.label} (+${fmt(up.d, m.format)}).` })
      if (down && down.d < 0) out.push({ tone: 'bad', text: `Plus fort recul : ${down.r.label} (${fmt(down.d, m.format)}).` })
    }
  }
  if (cfg.measures.includes('taux_marge')) {
    const low = real.filter((r) => r.values.taux_marge !== null && (r.values.ca_ht ?? 1) > 0).sort((a, b) => (a.values.taux_marge ?? 0) - (b.values.taux_marge ?? 0))[0]
    if (low && (low.values.taux_marge ?? 100) < 15) out.push({ tone: 'bad', text: `Marge faible : ${low.label} (${formatNumber(low.values.taux_marge!, 1)} %). Vérifiez les prix ou les coûts d’achat.` })
  }
  if (ds.id === 'creances' && (totals.reste_du ?? 0) > 0 && cfg.rows === 'anciennete') {
    const late = real.filter((r) => r.key >= '3').reduce((s, r) => s + (r.values.reste_du ?? 0), 0)
    if (late > 0) out.push({ tone: 'bad', text: `${fmt(late, 'money')} sont échus depuis plus de 60 jours (${formatNumber((late / (totals.reste_du ?? 1)) * 100, 0)} % des créances) : relancez en priorité.` })
  }
  return out.slice(0, 5)
}

/** Valeurs d'une dimension pour les filtres (200 plus fréquentes). */
export async function dimensionValues(ctx: Ctx, input: { dataset: string; dimension: string }) {
  const ds = (await allowedDatasets(ctx)).find((d) => d.id === input?.dataset)
  if (!ds) fail("Vous n'avez pas accès à ce jeu de données.")
  const q = SQL[ds.id]
  const dim = str(input.dimension)
  if (!(dim in q.dims)) fail('Regroupement inconnu.')
  const today = todayISO()
  const sql = `SELECT ${q.dims[dim]} AS k, COUNT(*)::int AS n ${q.from} GROUP BY 1 ORDER BY 2 DESC LIMIT 200`
  const uses = sql.includes('$TODAY')
  const rows = await ctx.db.query<{ k: string; n: number }>(uses ? sql.split('$TODAY').join('$1') : sql, uses ? [today] : [])
  return rows.map((r) => ({ key: String(r.k), label: dimLabel(dim, String(r.k), 'mois'), count: r.n }))
}

// ── Analyses enregistrées, tableau de bord, alertes ─────────────────────────────────

export async function listReports(ctx: Ctx) {
  return ctx.db.query(
    `SELECT r.id, r.name, r.config, r.shared, r.pinned, r.alert, r.owner_id, u.full_name AS owner_name, r.updated_at
     FROM saved_reports r LEFT JOIN users u ON u.id = r.owner_id
     WHERE r.owner_id = $1 OR r.shared ORDER BY r.pinned DESC, r.position, r.name`,
    [ctx.user!.id]
  )
}

export async function saveReport(ctx: Ctx, input: { id?: number; name: string; config: AnalysisConfig; shared?: boolean; pinned?: boolean; alert?: AlertRule | null }) {
  const name = str(input?.name)
  if (!name) fail("Donnez un nom à l'analyse.")
  const ds = findDataset(input?.config?.dataset)
  validate(ds, input.config)
  let alert: AlertRule | null = null
  if (input.alert) {
    if (!ds.measures.some((m) => m.id === input.alert!.measure)) fail("Mesure d'alerte inconnue.")
    if (!['<', '>'].includes(input.alert.op) || !Number.isFinite(Number(input.alert.threshold))) fail('Seuil d’alerte invalide.')
    alert = { measure: input.alert.measure, op: input.alert.op, threshold: Number(input.alert.threshold) }
  }
  const values = [name, JSON.stringify(input.config), !!input.shared, !!input.pinned, alert ? JSON.stringify(alert) : null]
  if (input.id) {
    const own = await ctx.db.one<{ owner_id: number }>('SELECT owner_id FROM saved_reports WHERE id = $1', [input.id])
    if (!own) fail('Analyse introuvable.')
    if (own.owner_id !== ctx.user!.id && ctx.user!.role !== 'admin') fail('Seul son auteur ou un administrateur peut modifier cette analyse.')
    await ctx.db.query('UPDATE saved_reports SET name = $2, config = $3, shared = $4, pinned = $5, alert = $6, updated_at = now() WHERE id = $1', [input.id, ...values])
    return { id: input.id }
  }
  const row = await ctx.db.one<{ id: number }>('INSERT INTO saved_reports (name, config, shared, pinned, alert, owner_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [...values, ctx.user!.id])
  await audit(ctx.db, ctx, 'création', 'analyse', row!.id, name)
  return row!
}

export async function deleteReport(ctx: Ctx, input: { id: number }) {
  const own = await ctx.db.one<{ owner_id: number; name: string }>('SELECT owner_id, name FROM saved_reports WHERE id = $1', [input?.id])
  if (!own) fail('Analyse introuvable.')
  if (own.owner_id !== ctx.user!.id && ctx.user!.role !== 'admin') fail('Seul son auteur ou un administrateur peut supprimer cette analyse.')
  await ctx.db.query('DELETE FROM saved_reports WHERE id = $1', [input.id])
  await audit(ctx.db, ctx, 'suppression', 'analyse', input.id, own.name)
  return true
}

/** Période glissante d'une analyse enregistrée : « ce mois », « 12 derniers mois »… recalculée à chaque ouverture. */
export function resolvePreset(cfg: AnalysisConfig & { preset?: string }, today = todayISO()): AnalysisConfig {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const ym = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}`
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  const q = Math.floor((m - 1) / 3)
  const ranges: Record<string, [string, string]> = {
    'ce-mois': [`${ym(y, m)}-01`, today],
    'mois-dernier': m === 1 ? [`${y - 1}-12-01`, `${y - 1}-12-31`] : [`${ym(y, m - 1)}-01`, `${ym(y, m - 1)}-${lastDay(y, m - 1)}`],
    'ce-trimestre': [`${ym(y, q * 3 + 1)}-01`, today],
    'cette-annee': [`${y}-01-01`, today],
    'annee-derniere': [`${y - 1}-01-01`, `${y - 1}-12-31`],
    '12-mois': [`${ym(m === 12 ? y : y - 1, m === 12 ? 1 : m + 1)}-01`, today],
    '30-jours': [addDays(today, -29), today]
  }
  const r = cfg.preset ? ranges[cfg.preset] : undefined
  return r ? { ...cfg, from: r[0], to: r[1] } : cfg
}

/** Analyses épinglées au tableau de bord, calculées (résultat compact). */
export async function pinned(ctx: Ctx) {
  const reports = (await listReports(ctx)).filter((r: any) => r.pinned)
  const out = []
  for (const r of reports.slice(0, 8)) {
    try {
      const cfg = resolvePreset(typeof r.config === 'string' ? JSON.parse(r.config) : r.config)
      out.push({ id: r.id, name: r.name, config: cfg, result: await runAnalysis(ctx, { ...cfg, top: cfg.top ?? 8 }) })
    } catch (e: any) {
      out.push({ id: r.id, name: r.name, error: String(e?.message ?? e) })
    }
  }
  return out
}

/** Alertes déclenchées : analyses enregistrées dont le total franchit le seuil. */
export async function alerts(ctx: Ctx) {
  const reports = (await listReports(ctx)).filter((r: any) => r.alert)
  const out = []
  for (const r of reports.slice(0, 20)) {
    try {
      const rule: AlertRule = typeof r.alert === 'string' ? JSON.parse(r.alert) : r.alert
      const cfg = resolvePreset(typeof r.config === 'string' ? JSON.parse(r.config) : r.config)
      const res = await runAnalysis(ctx, { ...cfg, measures: [rule.measure], rows: undefined, columns: undefined, compare: 'none' })
      const v = res.totals[rule.measure]
      if (v !== null && (rule.op === '<' ? v < rule.threshold : v > rule.threshold)) {
        const def = findDataset(cfg.dataset)!.measures.find((m) => m.id === rule.measure)!
        out.push({ id: r.id, name: r.name, measure: def.label, value: v, threshold: rule.threshold, op: rule.op, format: def.format })
      }
    } catch {
      /* analyse devenue invalide : ignorée */
    }
  }
  return out
}
