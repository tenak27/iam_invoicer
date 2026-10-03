// Clients et fournisseurs (« tiers »).

import { audit, fail, num, str, type Ctx } from './context'

export type PartyKind = 'client' | 'supplier'

const PREFIX: Record<PartyKind, string> = { client: 'CLI', supplier: 'FRS' }

// Solde : pour un client, ce qu'il nous doit ; pour un fournisseur, ce que nous lui devons.
const BALANCE_SQL = `
  COALESCE((SELECT SUM(CASE WHEN d.type IN ('FAC','FF') THEN d.total_ttc ELSE -d.total_ttc END)
            FROM documents d WHERE d.party_id = p.id AND d.status = 'valide' AND d.type IN ('FAC','AV','FF')), 0)
  - COALESCE((SELECT SUM(CASE WHEN (py.direction = 'in') = (p.kind = 'client') THEN py.amount ELSE -py.amount END)
              FROM payments py WHERE py.party_id = p.id), 0)`

export async function listParties(ctx: Ctx, args: { kind: PartyKind; search?: string; includeInactive?: boolean }) {
  const search = `%${str(args.search).toLowerCase()}%`
  return ctx.db.query(
    `SELECT p.*, (${BALANCE_SQL}) AS balance
     FROM parties p
     WHERE p.kind = $1 AND ($2 OR p.active)
       AND (lower(p.name) LIKE $3 OR lower(p.code) LIKE $3 OR lower(p.phone) LIKE $3 OR lower(p.contact) LIKE $3)
     ORDER BY p.name`,
    [args.kind, !!args.includeInactive, search]
  )
}

export async function getParty(ctx: Ctx, args: { id: number }) {
  const party = await ctx.db.one(`SELECT p.*, (${BALANCE_SQL}) AS balance FROM parties p WHERE p.id = $1`, [args.id])
  if (!party) fail('Tiers introuvable.')
  const documents = await ctx.db.query(
    `SELECT id, type, number, status, date, due_date, total_ttc,
            COALESCE((SELECT SUM(amount) FROM payments WHERE document_id = d.id), 0) AS paid
     FROM documents d WHERE party_id = $1 ORDER BY date DESC, id DESC LIMIT 200`,
    [args.id]
  )
  const payments = await ctx.db.query(
    `SELECT py.*, d.number AS document_number FROM payments py
     LEFT JOIN documents d ON d.id = py.document_id
     WHERE py.party_id = $1 ORDER BY py.date DESC, py.id DESC LIMIT 200`,
    [args.id]
  )
  return { party, documents, payments }
}

export async function saveParty(ctx: Ctx, input: any) {
  const kind: PartyKind = input.kind === 'supplier' ? 'supplier' : 'client'
  const name = str(input.name)
  if (!name) fail('Le nom est obligatoire.')
  const fields = {
    name,
    contact: str(input.contact),
    phone: str(input.phone),
    email: str(input.email),
    address: str(input.address),
    city: str(input.city),
    tax_id: str(input.tax_id),
    rccm: str(input.rccm),
    payment_terms: Math.max(0, Math.round(num(input.payment_terms))),
    notes: str(input.notes),
    active: input.active ?? true
  }
  return ctx.db.tx(async (db) => {
    if (input.id) {
      await db.query(
        `UPDATE parties SET name=$1, contact=$2, phone=$3, email=$4, address=$5, city=$6, tax_id=$7, rccm=$8,
         payment_terms=$9, notes=$10, active=$11 WHERE id=$12`,
        [...Object.values(fields), input.id]
      )
      await audit(db, ctx, 'modification', kind, input.id, name)
      return { id: input.id as number }
    }
    let code = str(input.code)
    if (!code) {
      const row = await db.one<{ n: number }>(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '\\D', '', 'g'), '')::int), 0)::int + 1 AS n
         FROM parties WHERE kind = $1 AND code LIKE $2`,
        [kind, PREFIX[kind] + '-%']
      )
      code = `${PREFIX[kind]}-${String(row!.n).padStart(4, '0')}`
    }
    if (await db.one('SELECT 1 FROM parties WHERE kind = $1 AND code = $2', [kind, code])) fail(`Le code ${code} existe déjà.`)
    const row = await db.one<{ id: number }>(
      `INSERT INTO parties (kind, code, name, contact, phone, email, address, city, tax_id, rccm, payment_terms, notes, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [kind, code, ...Object.values(fields)]
    )
    await audit(db, ctx, 'creation', kind, row!.id, name)
    return row!
  })
}
