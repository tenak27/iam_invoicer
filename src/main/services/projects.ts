// Projets / chantiers : suivi des temps, coûts, facturation et rentabilité.

import { treasuryFor } from '@shared/domain'
import { formatDate, todayISO } from '@shared/format'
import { EXPENSE_CATEGORIES, isLate, projectProgress, type ExpenseCategory, type TaskStatus } from '@shared/projects'
import { postEntry, removeSourceEntry } from './accounting'
import { audit, fail, num, str, type Ctx } from './context'
import { saveDocument } from './documents'
import { getSettings } from './settings'

const NET = "SUM(CASE WHEN d.type IN ('AV') THEN -d.total_ht ELSE d.total_ht END)"

export async function listProjects(ctx: Ctx, args: { search?: string; status?: string } = {}) {
  const search = `%${str(args.search).toLowerCase()}%`
  return ctx.db.query(
    `SELECT pr.*, pa.name AS party_name, u.full_name AS manager_name,
            COALESCE((SELECT SUM(hours) FROM time_entries t WHERE t.project_id = pr.id), 0) AS hours,
            COALESCE((SELECT SUM(hours * CASE WHEN rate > 0 THEN rate ELSE pr.hourly_rate END) FROM time_entries t
                      WHERE t.project_id = pr.id AND t.billable AND t.invoice_id IS NULL), 0) AS unbilled,
            COALESCE((SELECT ${NET} FROM documents d WHERE d.project_id = pr.id AND d.status = 'valide' AND d.type IN ('FAC','AV')), 0) AS invoiced,
            COALESCE((SELECT SUM(d.total_ht) FROM documents d WHERE d.project_id = pr.id AND d.status = 'valide' AND d.type = 'FF'), 0) AS purchases,
            COALESCE((SELECT SUM(amount_ht) FROM project_expenses e WHERE e.project_id = pr.id), 0) AS expenses,
            COALESCE((SELECT COUNT(*) FROM project_tasks k WHERE k.project_id = pr.id), 0)::int AS tasks_total,
            COALESCE((SELECT COUNT(*) FROM project_tasks k WHERE k.project_id = pr.id AND k.status = 'termine'), 0)::int AS tasks_done,
            COALESCE((SELECT COUNT(*) FROM project_tasks k WHERE k.project_id = pr.id AND k.status <> 'termine' AND k.due_date < $3), 0)::int AS tasks_late
     FROM projects pr LEFT JOIN parties pa ON pa.id = pr.party_id LEFT JOIN users u ON u.id = pr.manager_id
     WHERE (lower(pr.name) LIKE $1 OR lower(pr.code) LIKE $1 OR lower(COALESCE(pa.name, '')) LIKE $1) AND ($2 = '' OR pr.status = $2)
     ORDER BY CASE pr.status WHEN 'en_cours' THEN 0 WHEN 'prospect' THEN 1 WHEN 'suspendu' THEN 2 ELSE 3 END, pr.id DESC`,
    [search, str(args.status), todayISO()]
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
  const [expenses, tasks] = await Promise.all([
    ctx.db.query(
      `SELECT e.*, d.number AS invoice_number, u.full_name AS user_name FROM project_expenses e LEFT JOIN documents d ON d.id = e.invoice_id
       LEFT JOIN users u ON u.id = e.user_id WHERE e.project_id = $1 ORDER BY e.date DESC, e.id DESC`,
      [args.id]
    ),
    ctx.db.query(
      `SELECT k.*, u.full_name AS assignee_name,
              COALESCE((SELECT SUM(hours) FROM time_entries t WHERE t.task_id = k.id), 0) AS spent_hours
       FROM project_tasks k LEFT JOIN users u ON u.id = k.assignee_id WHERE k.project_id = $1 ORDER BY k.position, k.id`,
      [args.id]
    )
  ])
  // Valeur des heures (taux de facturation) et coût interne (coût horaire, à défaut le taux de facturation).
  const laborValue = entries.reduce((s, t) => s + t.hours * (t.rate > 0 ? t.rate : p.hourly_rate), 0)
  const laborCost = entries.reduce((s, t) => s + t.hours * (p.cost_rate > 0 ? p.cost_rate : t.rate > 0 ? t.rate : p.hourly_rate), 0)
  // Budget par poste : prévu / réalisé
  const lines = (p.budget_lines ?? {}) as Record<string, number>
  const byCategory = Object.entries(EXPENSE_CATEGORIES).map(([key, c]) => ({
    key, label: c.label,
    budget: Math.round(Number(lines[key]) || 0),
    actual: Math.round(expenses.filter((e) => e.category === key).reduce((s, e) => s + e.amount_ht, 0))
  }))
  const totalCost = Math.round(laborCost + p.expenses + p.purchases)
  const today = todayISO()
  const late = tasks.filter((t) => isLate(t, today))
  const unbilledExpenses = expenses.filter((e) => e.billable && !e.invoice_id).reduce((s, e) => s + e.amount_ht * (1 + e.markup / 100), 0)
  const alerts: string[] = []
  if (p.budget_amount > 0 && totalCost > p.budget_amount) alerts.push(`Coûts (${Math.round(totalCost)}) au-dessus du budget (${Math.round(p.budget_amount)}).`)
  if (p.budget_hours > 0 && p.hours > p.budget_hours) alerts.push(`Heures (${p.hours}) au-delà du budget (${p.budget_hours} h).`)
  for (const c of byCategory) if (c.budget > 0 && c.actual > c.budget) alerts.push(`Poste « ${c.label} » dépassé : ${c.actual} pour ${c.budget} prévus.`)
  if (late.length) alerts.push(`${late.length} tâche(s) en retard.`)
  if (p.end_date && p.end_date < today && !['termine', 'annule'].includes(p.status)) alerts.push(`Date de fin dépassée (${formatDate(p.end_date)}).`)
  return {
    ...p, expensesTotal: Math.round(p.expenses), entries, documents, byUser, expenses, tasks, byCategory, alerts,
    laborValue: Math.round(laborValue),
    laborCost: Math.round(laborCost),
    totalCost,
    unbilledExpenses: Math.round(unbilledExpenses),
    progress: projectProgress(tasks),
    margin: Math.round(p.invoiced - totalCost),
    budgetUsed: p.budget_amount > 0 ? Math.round((totalCost / p.budget_amount) * 100) : null
  }
}

// ---------- Dépenses ----------

/** Écriture d'une dépense : charge (et TVA récupérable) contre trésorerie ou fournisseur à payer. */
async function postExpense(db: Ctx['db'], ctx: Ctx, id: number) {
  await removeSourceEntry(db, 'depense', id)
  const e = await db.one('SELECT e.*, p.code FROM project_expenses e JOIN projects p ON p.id = e.project_id WHERE e.id = $1', [id])
  if (!e) return
  const account = EXPENSE_CATEGORIES[e.category as ExpenseCategory]?.account ?? '605'
  const tva = Math.round(e.amount_ttc - e.amount_ht)
  const counter = e.paid ? treasuryFor(e.payment_method || 'Espèces') : { account: '401', journal: 'AC' as const }
  await postEntry(db, ctx, {
    journal: e.paid ? counter.journal : 'AC',
    date: e.date,
    label: `${e.code} — ${e.description}`.slice(0, 120),
    source: 'depense',
    source_id: id,
    lines: [
      { account, debit: e.amount_ht },
      { account: '4452', debit: tva },
      { account: counter.account, credit: e.amount_ttc }
    ]
  })
}

export async function saveExpense(ctx: Ctx, input: any) {
  const category = (input.category in EXPENSE_CATEGORIES ? input.category : '') as ExpenseCategory | ''
  if (!category) fail('Choisissez le poste de dépense.')
  const description = str(input.description)
  if (!description) fail('Décrivez la dépense.')
  const ht = Math.round(num(input.amount_ht))
  if (ht <= 0) fail('Montant HT invalide.')
  const rate = Math.max(0, num(input.tva_rate))
  const ttc = Math.round(ht * (1 + rate / 100))
  const date = str(input.date) || todayISO()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Date invalide.')
  const receipt = str(input.receipt)
  if (receipt && !/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(receipt)) fail('Justificatif invalide : photo PNG ou JPG.')
  if (receipt.length > 1_500_000) fail('Justificatif trop lourd.')
  const paid = input.paid !== false
  const method = paid ? str(input.payment_method) || 'Espèces' : ''
  return ctx.db.tx(async (db) => {
    const project = await db.one('SELECT status FROM projects WHERE id = $1', [input.project_id])
    if (!project) fail('Projet introuvable.')
    if (project.status === 'annule') fail('Ce projet est annulé.')
    const values = [date, category, description, str(input.supplier), ht, rate, ttc, paid, method, !!input.billable, Math.max(0, num(input.markup)), receipt]
    let id = Number(input.id) || 0
    if (id) {
      const old = await db.one('SELECT invoice_id FROM project_expenses WHERE id = $1 AND project_id = $2', [id, input.project_id])
      if (!old) fail('Dépense introuvable.')
      if (old.invoice_id) fail('Cette dépense est déjà refacturée.')
      await db.query(
        'UPDATE project_expenses SET date=$1, category=$2, description=$3, supplier=$4, amount_ht=$5, tva_rate=$6, amount_ttc=$7, paid=$8, payment_method=$9, billable=$10, markup=$11, receipt=$12 WHERE id=$13',
        [...values, id]
      )
    } else {
      const row = await db.one<{ id: number }>(
        `INSERT INTO project_expenses (date, category, description, supplier, amount_ht, tva_rate, amount_ttc, paid, payment_method, billable, markup, receipt, project_id, user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [...values, input.project_id, ctx.user?.id ?? null]
      )
      id = row!.id
    }
    await postExpense(db, { ...ctx, db }, id)
    await audit(db, ctx, input.id ? 'modification' : 'creation', 'depense_projet', id, `${description} ${ttc}`)
    return { id }
  })
}

export async function deleteExpense(ctx: Ctx, input: { id: number }) {
  return ctx.db.tx(async (db) => {
    const e = await db.one('SELECT invoice_id, description FROM project_expenses WHERE id = $1', [input.id])
    if (!e) fail('Dépense introuvable.')
    if (e.invoice_id) fail('Cette dépense est déjà refacturée.')
    await removeSourceEntry(db, 'depense', input.id)
    await db.query('DELETE FROM project_expenses WHERE id = $1', [input.id])
    await audit(db, ctx, 'suppression', 'depense_projet', input.id, e.description)
    return true
  })
}

/** Refacture au client les dépenses refacturables (avec la marge prévue) : brouillon de facture. */
export async function invoiceExpenses(ctx: Ctx, input: { id: number }) {
  return ctx.db.tx(async (db) => {
    const c: Ctx = { ...ctx, db }
    const p = await db.one('SELECT * FROM projects WHERE id = $1', [input.id])
    if (!p) fail('Projet introuvable.')
    if (!p.party_id) fail('Rattachez un client au projet pour pouvoir refacturer.')
    const rows = await db.query('SELECT * FROM project_expenses WHERE project_id = $1 AND billable AND invoice_id IS NULL ORDER BY date, id FOR UPDATE', [p.id])
    if (rows.length === 0) fail('Aucune dépense refacturable en attente.')
    const tva = (await getSettings(db)).default_tva
    const lines = rows.map((e) => ({
      description: `${formatDate(e.date)} — ${EXPENSE_CATEGORIES[e.category as ExpenseCategory]?.label ?? 'Dépense'} : ${e.description}`,
      quantity: 1,
      unit_price: Math.round(e.amount_ht * (1 + e.markup / 100)),
      tva_rate: tva
    }))
    const { id } = await saveDocument(c, { type: 'FAC', party_id: p.party_id, project_id: p.id, reference: `${p.code} — ${p.name}`, lines })
    await db.query('UPDATE project_expenses SET invoice_id = $1 WHERE id = ANY($2)', [id, rows.map((e) => e.id)])
    await audit(db, ctx, 'facturation', 'projet', p.id, `${rows.length} dépense(s) refacturée(s)`)
    return { documentId: id }
  })
}

// ---------- Tâches et jalons ----------

const STATUSES: TaskStatus[] = ['a_faire', 'en_cours', 'bloque', 'termine']

export async function saveTask(ctx: Ctx, input: any) {
  const title = str(input.title)
  if (!title) fail('Donnez un intitulé à la tâche.')
  const status: TaskStatus = STATUSES.includes(input.status) ? input.status : 'a_faire'
  const start = str(input.start_date) || null
  const due = str(input.due_date) || null
  if (start && due && due < start) fail("L'échéance précède la date de début.")
  const progress = status === 'termine' ? 100 : Math.min(100, Math.max(0, Math.round(num(input.progress))))
  const values = [title, str(input.description), status, !!input.milestone, Number(input.assignee_id) || null, start, due, Math.max(0, num(input.estimated_hours)), progress]
  if (input.id) {
    await ctx.db.query(
      'UPDATE project_tasks SET title=$1, description=$2, status=$3, milestone=$4, assignee_id=$5, start_date=$6, due_date=$7, estimated_hours=$8, progress=$9 WHERE id=$10',
      [...values, input.id]
    )
    return { id: Number(input.id) }
  }
  if (!(await ctx.db.one('SELECT 1 FROM projects WHERE id = $1', [input.project_id]))) fail('Projet introuvable.')
  const row = await ctx.db.one<{ id: number }>(
    `INSERT INTO project_tasks (title, description, status, milestone, assignee_id, start_date, due_date, estimated_hours, progress, project_id, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, (SELECT COALESCE(MAX(position), 0) + 1 FROM project_tasks WHERE project_id = $10)) RETURNING id`,
    [...values, input.project_id]
  )
  return row!
}

/** Change le statut d'une tâche (tableau par glisser-déposer). */
export async function moveTask(ctx: Ctx, input: { id: number; status: TaskStatus }) {
  if (!STATUSES.includes(input.status)) fail('Statut inconnu.')
  await ctx.db.query(
    "UPDATE project_tasks SET status = $1, progress = CASE WHEN $1 = 'termine' THEN 100 WHEN status = 'termine' THEN 90 ELSE progress END WHERE id = $2",
    [input.status, input.id]
  )
  return true
}

export async function deleteTask(ctx: Ctx, input: { id: number }) {
  await ctx.db.query('DELETE FROM project_tasks WHERE id = $1', [input.id])
  return true
}

export async function projectUsers(ctx: Ctx) {
  return ctx.db.query('SELECT id, full_name FROM users WHERE active ORDER BY full_name')
}

export async function saveProject(ctx: Ctx, input: any) {
  const name = str(input.name)
  if (!name) fail('Le nom du projet est obligatoire.')
  const status = ['prospect', 'en_cours', 'suspendu', 'termine', 'annule'].includes(input.status) ? input.status : 'en_cours'
  const fields = [
    name, input.party_id ? Number(input.party_id) : null, status, str(input.start_date) || null, str(input.end_date) || null,
    Math.max(0, num(input.budget_amount)), Math.max(0, num(input.budget_hours)), Math.max(0, num(input.hourly_rate)),
    Number(input.manager_id) || ctx.user?.id || null, str(input.description),
    Math.max(0, num(input.cost_rate)),
    JSON.stringify(Object.fromEntries(Object.keys(EXPENSE_CATEGORIES).map((k) => [k, Math.max(0, num(input.budget_lines?.[k]))]).filter(([, v]) => (v as number) > 0)))
  ]
  if (input.id) {
    await ctx.db.query(
      `UPDATE projects SET name=$1, party_id=$2, status=$3, start_date=$4, end_date=$5, budget_amount=$6, budget_hours=$7, hourly_rate=$8,
       manager_id=$9, description=$10, cost_rate=$11, budget_lines=$12 WHERE id=$13`,
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
    `INSERT INTO projects (name, party_id, status, start_date, end_date, budget_amount, budget_hours, hourly_rate, manager_id, description, cost_rate, budget_lines, code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [...fields, code]
  )
  await audit(ctx.db, ctx, 'creation', 'projet', row!.id, name)
  return row!
}

export async function saveTime(ctx: Ctx, input: { id?: number; project_id: number; date?: string; hours: number; description: string; billable?: boolean; rate?: number; task_id?: number | null }) {
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
    await ctx.db.query('UPDATE time_entries SET date=$1, hours=$2, description=$3, billable=$4, rate=$5, task_id=$6 WHERE id=$7', [date, hours, description, input.billable !== false, Math.max(0, num(input.rate)), Number(input.task_id) || null, input.id])
    return { id: input.id }
  }
  const row = await ctx.db.one<{ id: number }>(
    'INSERT INTO time_entries (project_id, user_id, date, hours, description, billable, rate, task_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [input.project_id, ctx.user?.id ?? null, date, hours, description, input.billable !== false, Math.max(0, num(input.rate)), Number(input.task_id) || null]
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
    const tva = (await getSettings(db)).default_tva
    const lines = entries.map((t) => {
      const rate = t.rate > 0 ? t.rate : p.hourly_rate
      if (!rate) fail('Indiquez un taux horaire sur le projet ou sur chaque saisie.')
      return { description: `${t.date.split('-').reverse().join('/')} — ${t.description}`, quantity: t.hours, unit_price: rate, tva_rate: tva }
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
