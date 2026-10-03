// CRM : opportunités (pipeline), activités commerciales, conversion en devis.

import { todayISO } from '@shared/format'
import { audit, fail, num, str, type Ctx } from './context'
import { saveDocument } from './documents'
import { saveParty } from './parties'

export const STAGES = ['nouveau', 'qualifie', 'proposition', 'negociation', 'gagne', 'perdu'] as const
export type Stage = (typeof STAGES)[number]
/** Probabilité proposée à chaque étape (modifiable par opportunité). */
export const STAGE_PROBABILITY: Record<Stage, number> = { nouveau: 10, qualifie: 30, proposition: 50, negociation: 75, gagne: 100, perdu: 0 }

export async function listOpportunities(ctx: Ctx, args: { search?: string; owner?: number; includeClosed?: boolean } = {}) {
  const search = `%${str(args.search).toLowerCase()}%`
  return ctx.db.query(
    `SELECT o.*, p.name AS party_name, u.full_name AS owner_name, d.number AS quote_number,
            (SELECT MIN(due_date) FROM crm_activities a WHERE a.opportunity_id = o.id AND NOT a.done AND a.due_date IS NOT NULL) AS next_due,
            (SELECT COUNT(*)::int FROM crm_activities a WHERE a.opportunity_id = o.id) AS activities
     FROM opportunities o LEFT JOIN parties p ON p.id = o.party_id LEFT JOIN users u ON u.id = o.owner_id LEFT JOIN documents d ON d.id = o.quote_id
     WHERE (lower(o.title) LIKE $1 OR lower(COALESCE(p.name, o.prospect_name)) LIKE $1 OR lower(o.contact) LIKE $1)
       AND ($2::int IS NULL OR o.owner_id = $2)
       AND ($3 OR o.stage NOT IN ('gagne','perdu') OR o.updated_at > now() - interval '90 days')
     ORDER BY o.updated_at DESC LIMIT 1000`,
    [search, args.owner ?? null, !!args.includeClosed]
  )
}

export async function getOpportunity(ctx: Ctx, args: { id: number }) {
  const o = await ctx.db.one(
    `SELECT o.*, p.name AS party_name, u.full_name AS owner_name, d.number AS quote_number FROM opportunities o
     LEFT JOIN parties p ON p.id = o.party_id LEFT JOIN users u ON u.id = o.owner_id LEFT JOIN documents d ON d.id = o.quote_id WHERE o.id = $1`,
    [args.id]
  )
  if (!o) fail('Opportunité introuvable.')
  const activities = await ctx.db.query(
    'SELECT a.*, u.full_name AS user_name FROM crm_activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.opportunity_id = $1 ORDER BY a.done, a.due_date NULLS LAST, a.id DESC',
    [args.id]
  )
  return { ...o, activities }
}

export async function saveOpportunity(ctx: Ctx, input: any) {
  const title = str(input.title)
  if (!title) fail("Donnez un intitulé à l'opportunité.")
  const partyId = input.party_id ? Number(input.party_id) : null
  if (!partyId && !str(input.prospect_name)) fail('Choisissez un client ou saisissez le nom du prospect.')
  const stage: Stage = STAGES.includes(input.stage) ? input.stage : 'nouveau'
  const probability = input.probability === undefined || input.probability === '' ? STAGE_PROBABILITY[stage] : Math.min(100, Math.max(0, Math.round(num(input.probability))))
  const fields = [
    title, partyId, str(input.prospect_name), str(input.contact), str(input.phone), str(input.email), Math.max(0, num(input.amount)),
    probability, stage, str(input.expected_date) || null, str(input.source), str(input.notes), Number(input.owner_id) || ctx.user?.id || null
  ]
  if (input.id) {
    await ctx.db.query(
      `UPDATE opportunities SET title=$1, party_id=$2, prospect_name=$3, contact=$4, phone=$5, email=$6, amount=$7, probability=$8, stage=$9,
       expected_date=$10, source=$11, notes=$12, owner_id=$13, updated_at=now() WHERE id=$14`,
      [...fields, input.id]
    )
    await audit(ctx.db, ctx, 'modification', 'opportunite', input.id, title)
    return { id: input.id }
  }
  const row = await ctx.db.one<{ id: number }>(
    `INSERT INTO opportunities (title, party_id, prospect_name, contact, phone, email, amount, probability, stage, expected_date, source, notes, owner_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    fields
  )
  await audit(ctx.db, ctx, 'creation', 'opportunite', row!.id, title)
  return row!
}

/** Changement d'étape (glisser-déposer ou boutons) ; la probabilité suit l'étape. */
export async function moveStage(ctx: Ctx, input: { id: number; stage: Stage; lost_reason?: string }) {
  if (!STAGES.includes(input.stage)) fail('Étape inconnue.')
  if (input.stage === 'perdu' && !str(input.lost_reason)) fail('Indiquez la raison de la perte (prix, concurrent, délai…).')
  const o = await ctx.db.one('SELECT stage FROM opportunities WHERE id = $1', [input.id])
  if (!o) fail('Opportunité introuvable.')
  await ctx.db.query(
    'UPDATE opportunities SET stage = $1, probability = $2, lost_reason = $3, updated_at = now() WHERE id = $4',
    [input.stage, STAGE_PROBABILITY[input.stage], input.stage === 'perdu' ? str(input.lost_reason) : '', input.id]
  )
  await ctx.db.query(
    "INSERT INTO crm_activities (opportunity_id, kind, subject, done, user_id) VALUES ($1, 'note', $2, TRUE, $3)",
    [input.id, `Étape : ${o.stage} → ${input.stage}${input.stage === 'perdu' ? ` (${str(input.lost_reason)})` : ''}`, ctx.user?.id ?? null]
  )
  await audit(ctx.db, ctx, 'etape', 'opportunite', input.id, input.stage)
  return true
}

export async function saveActivity(ctx: Ctx, input: { id?: number; opportunity_id: number; kind: string; subject: string; due_date?: string; done?: boolean }) {
  if (!['appel', 'reunion', 'email', 'visite', 'note', 'tache'].includes(input.kind)) fail("Type d'activité inconnu.")
  const subject = str(input.subject)
  if (!subject) fail("Décrivez l'activité.")
  if (input.id) {
    await ctx.db.query('UPDATE crm_activities SET kind=$1, subject=$2, due_date=$3, done=$4 WHERE id=$5', [input.kind, subject, str(input.due_date) || null, !!input.done, input.id])
  } else {
    await ctx.db.query(
      'INSERT INTO crm_activities (opportunity_id, kind, subject, due_date, done, user_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [input.opportunity_id, input.kind, subject, str(input.due_date) || null, !!input.done, ctx.user?.id ?? null]
    )
  }
  await ctx.db.query('UPDATE opportunities SET updated_at = now() WHERE id = $1', [input.opportunity_id])
  return true
}

export async function toggleActivity(ctx: Ctx, input: { id: number }) {
  await ctx.db.query('UPDATE crm_activities SET done = NOT done WHERE id = $1', [input.id])
  return true
}

/** Activités à faire (aujourd'hui, en retard, à venir) pour l'utilisateur ou l'équipe. */
export async function agenda(ctx: Ctx, args: { mine?: boolean } = {}) {
  return ctx.db.query(
    `SELECT a.*, o.title AS opportunity_title, COALESCE(p.name, o.prospect_name) AS who
     FROM crm_activities a JOIN opportunities o ON o.id = a.opportunity_id LEFT JOIN parties p ON p.id = o.party_id
     WHERE NOT a.done AND a.due_date IS NOT NULL AND ($1::int IS NULL OR o.owner_id = $1)
     ORDER BY a.due_date LIMIT 100`,
    [args.mine ? ctx.user?.id ?? null : null]
  )
}

/** Synthèse du pipeline : nombre, montant et montant pondéré par étape. */
export async function pipeline(ctx: Ctx) {
  const rows = await ctx.db.query<{ stage: Stage; n: number; amount: number; weighted: number }>(
    `SELECT stage, COUNT(*)::int AS n, COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(amount * probability / 100.0), 0) AS weighted
     FROM opportunities WHERE stage NOT IN ('gagne','perdu') OR updated_at > date_trunc('year', now()) GROUP BY stage`
  )
  const won = rows.find((r) => r.stage === 'gagne')
  const lost = rows.find((r) => r.stage === 'perdu')
  const closed = (won?.n ?? 0) + (lost?.n ?? 0)
  return {
    stages: STAGES.map((s) => rows.find((r) => r.stage === s) ?? { stage: s, n: 0, amount: 0, weighted: 0 }),
    open: rows.filter((r) => r.stage !== 'gagne' && r.stage !== 'perdu').reduce((t, r) => ({ n: t.n + r.n, amount: t.amount + r.amount, weighted: t.weighted + r.weighted }), { n: 0, amount: 0, weighted: 0 }),
    winRate: closed ? Math.round(((won?.n ?? 0) / closed) * 100) : null
  }
}

/** Transforme l'opportunité en devis (crée le client si c'était un prospect). */
export async function createQuote(ctx: Ctx, input: { id: number }) {
  return ctx.db.tx(async (db) => {
    const c: Ctx = { ...ctx, db }
    const o = await db.one('SELECT * FROM opportunities WHERE id = $1 FOR UPDATE', [input.id])
    if (!o) fail('Opportunité introuvable.')
    if (o.quote_id) fail('Un devis a déjà été créé pour cette opportunité.')
    let partyId = o.party_id
    if (!partyId) {
      const p = await saveParty(c, { kind: 'client', name: o.prospect_name, contact: o.contact, phone: o.phone, email: o.email, notes: `Créé depuis l'opportunité « ${o.title} »` })
      partyId = p.id
    }
    const ht = Math.round(o.amount / 1.18)
    const { id } = await saveDocument(c, {
      type: 'DEV', party_id: partyId, date: todayISO(), reference: o.title,
      lines: [{ description: o.title, quantity: 1, unit_price: ht, tva_rate: 18 }]
    })
    await db.query("UPDATE opportunities SET party_id = $1, quote_id = $2, stage = CASE WHEN stage IN ('nouveau','qualifie') THEN 'proposition' ELSE stage END, probability = GREATEST(probability, 50), updated_at = now() WHERE id = $3", [partyId, id, o.id])
    await audit(db, ctx, 'devis', 'opportunite', o.id)
    return { documentId: id }
  })
}
