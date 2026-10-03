// Caisse : chaque utilisateur ouvre sa propre session (son tiroir), vend au
// comptoir, enregistre les entrées et sorties d'espèces, puis clôture en
// comptant le tiroir. L'écart éventuel est passé en comptabilité.
//
// Une vente au comptoir est une facture validée immédiatement et réglée : elle
// suit donc les mêmes règles que les autres ventes (stock, numérotation, TVA).

import { todayISO } from '@shared/format'
import type { Db } from '../db'
import { postEntry } from './accounting'
import { audit, fail, num, str, type Ctx, type SessionUser } from './context'
import { saveDocument, validateDocument } from './documents'
import { addPayment } from './payments'

const COUNTER_CODE = 'COMPTOIR'

async function openSession(db: Db, user: SessionUser) {
  return db.one("SELECT * FROM cash_sessions WHERE user_id = $1 AND status = 'ouverte'", [user.id])
}

function requireUserId(ctx: Ctx): SessionUser {
  if (!ctx.user) fail('Session expirée, veuillez vous reconnecter.')
  return ctx.user
}

/** Client « comptoir » utilisé pour les ventes anonymes. */
async function counterClient(db: Db): Promise<number> {
  const row = await db.one<{ id: number }>("SELECT id FROM parties WHERE kind = 'client' AND code = $1", [COUNTER_CODE])
  if (row) return row.id
  const created = await db.one<{ id: number }>(
    `INSERT INTO parties (kind, code, name, payment_terms, notes) VALUES ('client', $1, 'Client comptoir', 0, 'Ventes au comptoir (caisse)')
     RETURNING id`,
    [COUNTER_CODE]
  )
  return created!.id
}

/** Totaux d'une session ; « expected » = espèces attendues dans le tiroir. */
export async function sessionSummary(db: Db, sessionId: number) {
  const session = await db.one(
    `SELECT s.*, u.full_name AS user_name FROM cash_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [sessionId]
  )
  if (!session) fail('Session de caisse introuvable.')
  const [byMethod, movements, sales] = await Promise.all([
    db.query<{ method: string; direction: string; total: number; n: number }>(
      `SELECT method, direction, SUM(amount) AS total, COUNT(*)::int AS n
       FROM payments WHERE cash_session_id = $1 GROUP BY method, direction ORDER BY method`,
      [sessionId]
    ),
    db.query(
      `SELECT m.*, a.label AS account_label FROM cash_movements m JOIN accounts a ON a.number = m.account
       WHERE m.session_id = $1 ORDER BY m.id DESC`,
      [sessionId]
    ),
    db.query(
      `SELECT d.id, d.number, d.total_ttc, d.validated_at, p.name AS party_name,
              STRING_AGG(DISTINCT py.method, ', ') AS methods
       FROM payments py JOIN documents d ON d.id = py.document_id JOIN parties p ON p.id = d.party_id
       WHERE py.cash_session_id = $1 AND d.type = 'FAC'
       GROUP BY d.id, d.number, d.total_ttc, d.validated_at, p.name
       ORDER BY d.id DESC`,
      [sessionId]
    )
  ])
  const cash = (dir: string) =>
    byMethod.filter((m) => m.method === 'Espèces' && m.direction === dir).reduce((s, m) => s + m.total, 0)
  const entrees = movements.filter((m) => m.kind === 'entree').reduce((s, m) => s + m.amount, 0)
  const sorties = movements.filter((m) => m.kind === 'sortie').reduce((s, m) => s + m.amount, 0)
  const expected = session.opening_amount + cash('in') - cash('out') + entrees - sorties
  const salesTotal = byMethod.filter((m) => m.direction === 'in').reduce((s, m) => s + m.total, 0)
  return { session, byMethod, movements, sales, entrees, sorties, cashIn: cash('in'), cashOut: cash('out'), salesTotal, expected }
}

export async function current(ctx: Ctx) {
  const user = requireUserId(ctx)
  const s = await openSession(ctx.db, user)
  return s ? sessionSummary(ctx.db, s.id) : null
}

export async function open(ctx: Ctx, input: { opening_amount: number }) {
  const user = requireUserId(ctx)
  const amount = Math.round(num(input.opening_amount))
  if (amount < 0) fail("Fonds de caisse invalide.")
  return ctx.db.tx(async (db) => {
    if (await openSession(db, user)) fail('Votre caisse est déjà ouverte.')
    const row = await db.one<{ id: number }>('INSERT INTO cash_sessions (user_id, opening_amount) VALUES ($1, $2) RETURNING id', [
      user.id,
      amount
    ])
    await audit(db, ctx, 'ouverture', 'caisse', row!.id, `Fonds de caisse ${amount}`)
    return row!
  })
}

export async function sale(
  ctx: Ctx,
  input: { party_id?: number | null; lines: any[]; payments: { method: string; amount: number }[]; notes?: string }
) {
  const user = requireUserId(ctx)
  return ctx.db.tx(async (db) => {
    const session = await openSession(db, user)
    if (!session) fail("Ouvrez la caisse avant d'encaisser.")
    const c: Ctx = { ...ctx, db }
    const partyId = input.party_id ? Number(input.party_id) : await counterClient(db)
    const isCounter = !input.party_id
    const { id } = await saveDocument(c, {
      type: 'FAC',
      party_id: partyId,
      date: todayISO(),
      due_date: todayISO(),
      notes: str(input.notes) || 'Vente au comptoir',
      lines: input.lines,
      taxes: []
    })
    const doc = await validateDocument(c, { id })
    const pays = (input.payments ?? [])
      .map((p) => ({ method: str(p.method), amount: Math.round(num(p.amount)) }))
      .filter((p) => p.amount > 0)
    const paid = pays.reduce((s, p) => s + p.amount, 0)
    if (paid > doc.total_ttc) fail('Le total des règlements dépasse le montant de la vente.')
    if (isCounter && paid < doc.total_ttc)
      fail('Une vente au client comptoir doit être réglée en totalité. Choisissez un client pour une vente à crédit.')
    for (const p of pays) {
      await addPayment(c, { document_id: id, amount: p.amount, method: p.method, reference: 'Caisse' }, { cashSessionId: session.id })
    }
    await audit(db, ctx, 'vente', 'caisse', session.id, doc.number)
    return { id, number: doc.number as string, total_ttc: doc.total_ttc as number, paid }
  })
}

export async function movement(ctx: Ctx, input: { kind: 'entree' | 'sortie'; amount: number; account: string; label: string }) {
  const user = requireUserId(ctx)
  if (input.kind !== 'entree' && input.kind !== 'sortie') fail('Type de mouvement inconnu.')
  const amount = Math.round(num(input.amount))
  if (amount <= 0) fail('Montant invalide.')
  const label = str(input.label)
  if (!label) fail('Indiquez le motif.')
  const account = str(input.account)
  if (!account || account === '571') fail('Choisissez le compte de contrepartie.')
  return ctx.db.tx(async (db) => {
    const session = await openSession(db, user)
    if (!session) fail("Ouvrez la caisse d'abord.")
    if (input.kind === 'sortie') {
      const { expected } = await sessionSummary(db, session.id)
      if (amount > expected) fail(`Espèces insuffisantes en caisse (${Math.round(expected)}).`)
    }
    const row = await db.one<{ id: number }>(
      `INSERT INTO cash_movements (session_id, kind, amount, account, label, user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [session.id, input.kind, amount, account, label, user.id]
    )
    await postEntry(db, ctx, {
      journal: 'CA',
      date: todayISO(),
      label,
      source: 'cash_movement',
      source_id: row!.id,
      lines:
        input.kind === 'entree'
          ? [{ account: '571', debit: amount }, { account, credit: amount }]
          : [{ account, debit: amount }, { account: '571', credit: amount }]
    })
    await audit(db, ctx, input.kind === 'entree' ? 'entree' : 'sortie', 'caisse', session.id, `${amount} — ${label}`)
    return row!
  })
}

export async function close(ctx: Ctx, input: { counted_amount: number; note?: string }) {
  const user = requireUserId(ctx)
  const counted = Math.round(num(input.counted_amount))
  if (counted < 0) fail('Montant compté invalide.')
  return ctx.db.tx(async (db) => {
    const session = await openSession(db, user)
    if (!session) fail("Votre caisse n'est pas ouverte.")
    const { expected } = await sessionSummary(db, session.id)
    const diff = counted - Math.round(expected)
    if (diff !== 0 && !str(input.note)) fail(`Écart de ${diff} : indiquez une explication avant de clôturer.`)
    await db.query(
      "UPDATE cash_sessions SET status = 'fermee', closed_at = now(), expected_amount = $1, counted_amount = $2, note = $3 WHERE id = $4",
      [Math.round(expected), counted, str(input.note), session.id]
    )
    if (diff !== 0) {
      await postEntry(db, ctx, {
        journal: 'CA',
        date: todayISO(),
        label: `Écart de caisse — session ${session.id}`,
        source: 'cash_session',
        source_id: session.id,
        lines:
          diff > 0
            ? [{ account: '571', debit: diff }, { account: '758', credit: diff }]
            : [{ account: '658', debit: -diff }, { account: '571', credit: -diff }]
      })
    }
    await audit(db, ctx, 'cloture', 'caisse', session.id, `Attendu ${Math.round(expected)}, compté ${counted}`)
    return sessionSummary(db, session.id)
  })
}

export async function history(ctx: Ctx, args: { from?: string; to?: string } = {}) {
  // Un caissier ne voit que ses propres sessions ; les responsables voient toutes les caisses.
  const own = ctx.user?.role === 'caissier' ? ctx.user.id : null
  return ctx.db.query(
    `SELECT s.*, u.full_name AS user_name,
            COALESCE((SELECT SUM(amount) FROM payments WHERE cash_session_id = s.id AND direction = 'in'), 0) AS sales_total
     FROM cash_sessions s JOIN users u ON u.id = s.user_id
     WHERE ($1::int IS NULL OR s.user_id = $1)
       AND ($2 = '' OR s.opened_at::date >= $2::date) AND ($3 = '' OR s.opened_at::date <= $3::date)
     ORDER BY s.id DESC LIMIT 300`,
    [own, str(args.from), str(args.to)]
  )
}

export async function detail(ctx: Ctx, args: { id: number }) {
  const summary = await sessionSummary(ctx.db, args.id)
  if (ctx.user?.role === 'caissier' && summary.session.user_id !== ctx.user.id) fail("Vous n'avez pas accès à cette caisse.")
  return summary
}

/** Clients et comptes de contrepartie proposés à la caisse. */
export async function options(ctx: Ctx) {
  const [clients, accounts] = await Promise.all([
    ctx.db.query("SELECT id, code, name FROM parties WHERE kind = 'client' AND active AND code <> $1 ORDER BY name", [COUNTER_CODE]),
    ctx.db.query("SELECT number, label FROM accounts WHERE active AND number <> '571' AND number ~ '^[1-7]' ORDER BY number")
  ])
  return { clients, accounts }
}
