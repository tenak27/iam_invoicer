// Factures récurrentes : contrats de maintenance, abonnements, loyers.
// À chaque échéance, une facture est créée (brouillon à vérifier, ou validée
// directement) et la date suivante est calculée. Les échéances manquées pendant
// une absence sont rattrapées une par une.

import { addDays, todayISO } from '@shared/format'
import { audit, fail, num, str, type Ctx } from './context'
import { saveDocument, validateDocument } from './documents'

export type Frequency = 'mensuel' | 'trimestriel' | 'semestriel' | 'annuel'
const MONTHS: Record<Frequency, number> = { mensuel: 1, trimestriel: 3, semestriel: 6, annuel: 12 }

/** Date d'échéance suivante (même jour du mois, ramené au dernier jour si besoin). */
export function nextDate(iso: string, f: Frequency): string {
  const [y, m, d] = iso.split('-').map(Number)
  const total = y * 12 + (m - 1) + MONTHS[f]
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

export async function listRecurring(ctx: Ctx) {
  return ctx.db.query(
    `SELECT r.*, p.name AS party_name, d.number AS last_number,
            (SELECT COALESCE(SUM((l->>'quantity')::float * (l->>'unit_price')::float * (1 - COALESCE((l->>'discount')::float, 0) / 100)), 0)
             FROM jsonb_array_elements(r.lines) l) AS amount_ht
     FROM recurring_invoices r JOIN parties p ON p.id = r.party_id LEFT JOIN documents d ON d.id = r.last_document_id
     ORDER BY r.active DESC, r.next_date`
  )
}

export async function saveRecurring(ctx: Ctx, input: any) {
  const label = str(input.label)
  if (!label) fail('Donnez un libellé au contrat (ex. Maintenance informatique).')
  const frequency: Frequency = input.frequency in MONTHS ? input.frequency : 'mensuel'
  const next = str(input.next_date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) fail('Date de la prochaine facture invalide.')
  const end = str(input.end_date) || null
  if (end && end < next) fail('La date de fin précède la prochaine facture.')
  const lines = (Array.isArray(input.lines) ? input.lines : [])
    .map((l: any) => ({ product_id: l.product_id ? Number(l.product_id) : null, description: str(l.description), quantity: num(l.quantity) || 1, unit_price: num(l.unit_price), discount: num(l.discount), tva_rate: num(l.tva_rate) }))
    .filter((l: any) => l.description)
  if (!lines.length) fail('Ajoutez au moins une ligne.')
  const party = await ctx.db.one("SELECT id FROM parties WHERE id = $1 AND kind = 'client'", [input.party_id])
  if (!party) fail('Choisissez un client.')
  const values = [party.id, label, JSON.stringify(lines), JSON.stringify(Array.isArray(input.taxes) ? input.taxes : []), frequency, next, end, !!input.auto_validate, Number(input.project_id) || null, input.active !== false]
  if (input.id) {
    await ctx.db.query(
      'UPDATE recurring_invoices SET party_id=$1, label=$2, lines=$3, taxes=$4, frequency=$5, next_date=$6, end_date=$7, auto_validate=$8, project_id=$9, active=$10 WHERE id=$11',
      [...values, input.id]
    )
    await audit(ctx.db, ctx, 'modification', 'facture_recurrente', Number(input.id), label)
    return { id: Number(input.id) }
  }
  const row = await ctx.db.one<{ id: number }>(
    `INSERT INTO recurring_invoices (party_id, label, lines, taxes, frequency, next_date, end_date, auto_validate, project_id, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    values
  )
  await audit(ctx.db, ctx, 'creation', 'facture_recurrente', row!.id, label)
  return row!
}

/** Contrat créé à partir d'une facture existante (mêmes client, lignes et taxes). */
export async function fromDocument(ctx: Ctx, input: { id: number; frequency?: Frequency }) {
  const d = await ctx.db.one("SELECT * FROM documents WHERE id = $1 AND type = 'FAC'", [input.id])
  if (!d) fail('Facture introuvable.')
  const lines = await ctx.db.query('SELECT product_id, description, quantity, unit_price, discount, tva_rate FROM document_lines WHERE document_id = $1 ORDER BY position', [d.id])
  const frequency: Frequency = input.frequency && input.frequency in MONTHS ? input.frequency : 'mensuel'
  return saveRecurring(ctx, {
    party_id: d.party_id,
    label: d.reference || `Contrat ${d.number ?? ''}`.trim(),
    lines,
    taxes: (d.taxes ?? []).map((t: any) => t.code),
    frequency,
    next_date: nextDate(d.date, frequency),
    project_id: d.project_id
  })
}

export async function deleteRecurring(ctx: Ctx, input: { id: number }) {
  await ctx.db.query('DELETE FROM recurring_invoices WHERE id = $1', [input.id])
  return true
}

/** Crée les factures arrivées à échéance (rattrapage compris). */
export async function runDue(ctx: Ctx, input: { today?: string } = {}) {
  const today = str(input.today) || todayISO()
  const due = await ctx.db.query("SELECT * FROM recurring_invoices WHERE active AND next_date <= $1 ORDER BY next_date, id", [today])
  const created: { id: number; label: string; documentId: number; validated: boolean }[] = []
  for (const r of due) {
    let next: string = r.next_date
    // Au plus 24 échéances rattrapées par contrat et par passage (sécurité)
    for (let i = 0; i < 24 && next <= today && (!r.end_date || next <= r.end_date); i++) {
      const documentId = await ctx.db.tx(async (db) => {
        const c: Ctx = { ...ctx, db }
        const period = `${next.split('-').reverse().join('/')}`
        const { id } = await saveDocument(c, {
          type: 'FAC', party_id: r.party_id, date: next, project_id: r.project_id,
          reference: r.label, notes: `${r.label} — échéance du ${period}`, lines: r.lines, taxes: r.taxes
        })
        if (r.auto_validate) await validateDocument(c, { id })
        const following = nextDate(next, r.frequency)
        await db.query(
          'UPDATE recurring_invoices SET next_date = $1, generated = generated + 1, last_document_id = $2, active = CASE WHEN end_date IS NOT NULL AND $1 > end_date THEN FALSE ELSE active END WHERE id = $3',
          [following, id, r.id]
        )
        return id
      })
      created.push({ id: r.id, label: r.label, documentId, validated: !!r.auto_validate })
      next = nextDate(next, r.frequency)
    }
  }
  if (created.length) await audit(ctx.db, ctx, 'generation', 'factures_recurrentes', null, `${created.length} facture(s)`)
  return { created }
}

/** Contrats dont l'échéance tombe dans les jours à venir (tableau de bord). */
export async function upcoming(ctx: Ctx, args: { days?: number } = {}) {
  return ctx.db.query(
    "SELECT r.id, r.label, r.next_date, p.name AS party_name FROM recurring_invoices r JOIN parties p ON p.id = r.party_id WHERE r.active AND r.next_date <= $1 ORDER BY r.next_date",
    [addDays(todayISO(), Number(args.days) || 7)]
  )
}
