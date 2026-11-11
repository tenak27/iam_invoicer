// Encaissements (clients) et décaissements (fournisseurs, remboursements d'avoirs).

import { can, DOC_TYPES, type DocType } from '@shared/domain'
import { todayISO } from '@shared/format'
import { audit, fail, isoDate, num, str, type Ctx } from './context'
import { postPayment, removeSourceEntry } from './accounting'

/** Côtés que l'utilisateur peut voir et régler : ventes (encaissements), achats (décaissements) ; la comptabilité voit tout. */
function sides(ctx: Ctx): { sale: boolean; purchase: boolean } {
  const role = ctx.user?.role
  if (!role) return { sale: true, purchase: true } // appels internes (tâches du serveur)
  const all = role === 'admin' || can(role, 'accounting')
  return { sale: all || can(role, 'sales') || can(role, 'cash') || can(role, 'clients'), purchase: all || can(role, 'purchases') || can(role, 'suppliers') }
}

export async function listPayments(ctx: Ctx, args: { direction?: string; from?: string; to?: string; search?: string } = {}) {
  const search = `%${str(args.search).toLowerCase()}%`
  const see = sides(ctx)
  return ctx.db.query(
    `SELECT py.*, p.name AS party_name, p.kind AS party_kind, d.number AS document_number, d.type AS document_type, u.full_name AS user_name
     FROM payments py
     JOIN parties p ON p.id = py.party_id
     LEFT JOIN documents d ON d.id = py.document_id
     LEFT JOIN users u ON u.id = py.user_id
     WHERE ($1 = '' OR py.direction = $1)
       AND (($5 AND p.kind = 'client') OR ($6 AND p.kind <> 'client'))
       AND ($2 = '' OR py.date >= $2) AND ($3 = '' OR py.date <= $3)
       AND (lower(p.name) LIKE $4 OR lower(COALESCE(d.number, '')) LIKE $4 OR lower(py.reference) LIKE $4)
     ORDER BY py.date DESC, py.id DESC LIMIT 2000`,
    [str(args.direction), str(args.from), str(args.to), search, see.sale, see.purchase]
  )
}

/** Sens du règlement d'un document : on encaisse une facture client, on décaisse le reste. */
export function directionFor(type: DocType): 'in' | 'out' {
  return type === 'FAC' ? 'in' : 'out'
}

export async function addPayment(
  ctx: Ctx,
  input: { document_id: number; amount: number; date?: string; method: string; reference?: string; note?: string },
  opts: { cashSessionId?: number } = {}
) {
  return ctx.db.tx(async (db) => {
    const doc = await db.one(
      `SELECT d.id, d.type, d.number, d.status, d.party_id, d.total_ttc,
              COALESCE((SELECT SUM(amount) FROM payments WHERE document_id = d.id), 0) AS paid
       FROM documents d WHERE d.id = $1 FOR UPDATE`,
      [input.document_id]
    )
    if (!doc) fail('Document introuvable.')
    // Un document d'achat ne se règle qu'avec le droit sur les achats, un document de vente avec celui sur les ventes
    const side = DOC_TYPES[doc.type as DocType].side === 'purchase' ? 'purchase' : 'sale'
    if (!opts.cashSessionId && !sides(ctx)[side]) fail("Vous n'avez pas les droits pour régler ce document.")
    if (!DOC_TYPES[doc.type as DocType].payable) fail('Ce type de document ne se règle pas.')
    if (doc.status !== 'valide') fail('Seul un document validé peut être réglé.')
    const amount = Math.round(num(input.amount))
    if (amount <= 0) fail('Montant invalide.')
    const remaining = doc.total_ttc - doc.paid
    if (amount > remaining + 0.5) fail(`Le montant dépasse le reste à régler (${Math.round(remaining)}).`)
    if (!str(input.method)) fail('Choisissez un mode de paiement.')
    const date = isoDate(input.date, todayISO())
    // Ventes au comptoir : tous les règlements sont rattachés à la caisse. Ailleurs, seules les
    // espèces reçues ou versées par un utilisateur dont la caisse est ouverte y passent.
    let sessionId = opts.cashSessionId ?? null
    if (!sessionId && ctx.user && str(input.method) === 'Espèces') {
      const s = await db.one<{ id: number }>("SELECT id FROM cash_sessions WHERE user_id = $1 AND status = 'ouverte'", [ctx.user.id])
      sessionId = s?.id ?? null
    }
    const row = await db.one<{ id: number }>(
      `INSERT INTO payments (direction, party_id, document_id, date, amount, method, reference, note, user_id, cash_session_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        directionFor(doc.type),
        doc.party_id,
        doc.id,
        date,
        amount,
        str(input.method),
        str(input.reference),
        str(input.note),
        ctx.user?.id ?? null,
        sessionId
      ]
    )
    await postPayment(db, ctx, row!.id)
    await audit(db, ctx, 'paiement', doc.type, doc.id, `${amount} — ${doc.number}`)
    return row!
  })
}

export async function deletePayment(ctx: Ctx, args: { id: number }) {
  return ctx.db.tx(async (db) => {
    const p = await db.one('SELECT * FROM payments WHERE id = $1', [args.id])
    if (!p) fail('Paiement introuvable.')
    if (!sides(ctx)[p.direction === 'in' ? 'sale' : 'purchase']) fail("Vous n'avez pas les droits pour supprimer ce paiement.")
    if (p.cash_session_id) {
      const s = await db.one('SELECT status, user_id FROM cash_sessions WHERE id = $1', [p.cash_session_id])
      // Paiement d'une caisse : seul son caissier ou un responsable (comptabilité, administrateur) peut le retirer
      const role = ctx.user?.role
      if (ctx.user && s && s.user_id !== ctx.user.id && role !== 'admin' && !can(role!, 'accounting')) fail("Ce paiement appartient à la caisse d'un autre utilisateur.")
      if (s?.status === 'fermee') fail('Ce paiement appartient à une caisse clôturée et ne peut plus être supprimé.')
    }
    await removeSourceEntry(db, 'payment', args.id)
    await db.query('DELETE FROM payments WHERE id = $1', [args.id])
    await audit(db, ctx, 'suppression', 'paiement', args.id, `${p.amount} du ${p.date}`)
    return true
  })
}
