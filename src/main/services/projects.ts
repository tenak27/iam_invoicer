// Projets / chantiers : suivi des temps, coûts, facturation et rentabilité.

import { todayISO } from '@shared/format'
import { audit, fail, num, str, type Ctx } from './context'
import { saveDocument } from './documents'

const NET = "SUM(CASE WHEN d.type IN ('AV') THEN -d.total_ht ELSE d.total_ht END)"

export async function listProjects(ctx: Ctx, args: { search?: string; status?: string } = {}) {
  const search = `%${str(args.search).toLowerCase()}%`
  return ctx.db.query(
    `SELECT pr.*, pa.name AS party_name, u.full_name AS manager_name,
            COALESCE((SELECT SUM(hours) FROM time_entries t WHERE t.project_id = pr.id), 0) AS hours,
            COALESCE((SELECT SUM(hours * CASE WHEN rate > 0 THEN rate ELSE pr.hourly_rate END) FROM time_entries t
                      WHERE t.project_id = pr.id AND t.billable AND t.invoice_id IS NULL), 0) AS unbilled,
            COALESCE((SELECT ${NET} FROM documents d WHERE d.project_id = pr.id AND d.status = 'valide' AND d.type IN ('FAC','AV')), 0) AS invoiced,
            COALESCE((SELECT SUM(d.total_ht) FROM documents d WHERE d.project_id = pr.id AND d.status = 'valide' AND d.type = 'FF'), 0) AS purchases
     FROM projects pr LEFT JOIN parties pa ON pa.id = pr.party_id LEFT JOIN users u ON u.id = pr.manager_id
     WHERE (lower(pr.name) LIKE $1 OR lower(pr.code) LIKE $1 OR lower(COALESCE(pa.name, '')) LIKE $1) AND ($2 = '' OR pr.status = $2)
     ORDER BY CASE pr.status WHEN 'en_cours' THEN 0 WHEN 'prospect' THEN 1 WHEN 'suspendu' THEN 2 ELSE 3 END, pr.id DESC`,
    [search, str(args.status)]
  )
}

export async function getProject(ctx: Ctx, args: { id: number }) {
  const [p] = (await listProjects(ctx, {})).filter((x) => x.id === Number(args.id))
  if (!p) fail('Projet introuvable.')
  const [entries, documents, byUser] = await Promise.all([
    ctx.db.query(
      `SELECT t.*, u.full_name AS user_name, d.number AS invoice_number FROM time_entries t LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN documents d ON d.id = t.invoice_id WHERE t.project_id = $1 ORDER BY t.date DESC, t.id DESC`,
      [args.id]
    ),
    ctx.db.query('SELECT id, type, number, status, date, total_ht, total_ttc FROM documents WHERE project_id = $1 ORDER BY date DESC, id DESC', [args.id]),
    ctx.db.query(
      `SELECT COALESCE(u.full_name, '—') AS name, SUM(t.hours) AS hours FROM time_entries t LEFT JOIN users u ON u.id = t.user_id
       WHERE t.project_id = $1 GROUP BY u.full_name ORDER BY hours DESC`,
      [args.id]
    )
  ])
  // Coût des heures valorisé au taux du projet (approximation de gestion).
  const laborCost = entries.reduce((s, t) => s + t.hours * (t.rate > 0 ? t.rate : p.hourly_rate), 0)
  return { ...p, entries, documents, byUser, laborValue: Math.round(laborCost), margin: Math.round(p.invoiced - p.purchases) }
}

export async function saveProject(ctx: Ctx, input: any) {
  const name = str(input.name)
  if (!name) fail('Le nom du projet est obligatoire.')
  const status = ['prospect', 'en_cours', 'suspendu', 'termine', 'annule'].includes(input.status) ? input.status : 'en_cours'
  const fields = [
    name, input.party_id ? Number(input.party_id) : null, status, str(input.start_date) || null, str(input.end_date) || null,
    Math.max(0, num(input.budget_amount)), Math.max(0, num(input.budget_hours)), Math.max(0, num(input.hourly_rate)),
    Number(input.manager_id) || ctx.user?.id || null, str(input.description)
  ]
  if (input.id) {
    await ctx.db.query(
      `UPDATE projects SET name=$1, party_id=$2, status=$3, start_date=$4, end_date=$5, budget_amount=$6, budget_hours=$7, hourly_rate=$8,
       manager_id=$9, description=$10 WHERE id=$11`,
      [...fields, input.id]
    )
    await audit(ctx.db, ctx, 'modification', 'projet', input.id, name)
    return { id: input.id }
  }
  const year = todayISO().slice(0, 4)
  const seq = await ctx.db.one<{ value: number }>(
    'INSERT INTO sequences (key, value) VALUES ($1, 1) ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1 RETURNING value',
    [`PRJ-${year}`]
  )
  const code = str(input.code) || `PRJ-${year}-${String(seq!.value).padStart(3, '0')}`
  if (await ctx.db.one('SELECT 1 FROM projects WHERE code = $1', [code])) fail('Ce code de projet existe déjà.')
  const row = await ctx.db.one<{ id: number }>(
    `INSERT INTO projects (name, party_id, status, start_date, end_date, budget_amount, budget_hours, hourly_rate, manager_id, description, code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [...fields, code]
  )
  await audit(ctx.db, ctx, 'creation', 'projet', row!.id, name)
  return row!
}

export async function saveTime(ctx: Ctx, input: { id?: number; project_id: number; date?: string; hours: number; description: string; billable?: boolean; rate?: number }) {
  const hours = num(input.hours)
  if (hours <= 0 || hours > 24) fail('Durée invalide (entre 0 et 24 heures).')
  const description = str(input.description)
  if (!description) fail('Décrivez le travail effectué.')
  const date = str(input.date) || todayISO()
  const project = await ctx.db.one('SELECT status FROM projects WHERE id = $1', [input.project_id])
  if (!project) fail('Projet introuvable.')
  if (project.status === 'annule') fail('Ce projet est annulé.')
  if (input.id) {
    const t = await ctx.db.one('SELECT invoice_id FROM time_entries WHERE id = $1', [input.id])
    if (t?.invoice_id) fail('Ce temps est déjà facturé.')
    await ctx.db.query('UPDATE time_entries SET date=$1, hours=$2, description=$3, billable=$4, rate=$5 WHERE id=$6', [date, hours, description, input.billable !== false, Math.max(0, num(input.rate)), input.id])
    return { id: input.id }
  }
  const row = await ctx.db.one<{ id: number }>(
    'INSERT INTO time_entries (project_id, user_id, date, hours, description, billable, rate) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [input.project_id, ctx.user?.id ?? null, date, hours, description, input.billable !== false, Math.max(0, num(input.rate))]
  )
  return row!
}

export async function deleteTime(ctx: Ctx, input: { id: number }) {
  const t = await ctx.db.one('SELECT invoice_id FROM time_entries WHERE id = $1', [input.id])
  if (!t) fail('Saisie introuvable.')
  if (t.invoice_id) fail('Ce temps est déjà facturé.')
  await ctx.db.query('DELETE FROM time_entries WHERE id = $1', [input.id])
  return true
}

/** Feuille de temps de l'utilisateur sur une semaine. */
export async function myWeek(ctx: Ctx, args: { from: string }) {
  const from = str(args.from) || todayISO()
  return ctx.db.query(
    `SELECT t.*, p.code, p.name AS project_name FROM time_entries t JOIN projects p ON p.id = t.project_id
     WHERE t.user_id = $1 AND t.date >= $2 AND t.date < (($2)::date + 7)::text ORDER BY t.date, t.id`,
    [ctx.user?.id ?? null, from]
  )
}

/** Facture les heures facturables non facturées (brouillon de facture, une ligne par saisie). */
export async function invoiceTime(ctx: Ctx, input: { id: number }) {
  return ctx.db.tx(async (db) => {
    const c: Ctx = { ...ctx, db }
    const p = await db.one('SELECT * FROM projects WHERE id = $1', [input.id])
    if (!p) fail('Projet introuvable.')
    if (!p.party_id) fail('Rattachez un client au projet pour pouvoir le facturer.')
    const entries = await db.query('SELECT * FROM time_entries WHERE project_id = $1 AND billable AND invoice_id IS NULL ORDER BY date, id FOR UPDATE', [p.id])
    if (entries.length === 0) fail('Aucun temps facturable en attente.')
    const lines = entries.map((t) => {
      const rate = t.rate > 0 ? t.rate : p.hourly_rate
      if (!rate) fail('Indiquez un taux horaire sur le projet ou sur chaque saisie.')
      return { description: `${t.date.split('-').reverse().join('/')} — ${t.description}`, quantity: t.hours, unit_price: rate, tva_rate: 18 }
    })
    const { id } = await saveDocument(c, { type: 'FAC', party_id: p.party_id, project_id: p.id, reference: `${p.code} — ${p.name}`, lines })
    await db.query('UPDATE time_entries SET invoice_id = $1 WHERE id = ANY($2)', [id, entries.map((e) => e.id)])
    await audit(db, ctx, 'facturation', 'projet', p.id, `${entries.length} saisie(s)`)
    return { documentId: id }
  })
}

export async function projectOptions(ctx: Ctx) {
  return ctx.db.query("SELECT id, code, name FROM projects WHERE status IN ('prospect','en_cours','suspendu') ORDER BY code DESC")
}
