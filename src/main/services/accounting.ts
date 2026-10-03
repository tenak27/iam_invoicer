// Comptabilité générale SYSCOHADA révisé.
//
// Les écritures des pièces de gestion (factures, avoirs, factures fournisseurs,
// règlements, mouvements et écarts de caisse) sont générées automatiquement et
// une seule fois par pièce (index unique source + source_id). Les opérations
// diverses sont saisies à la main dans le journal OD.

import { JOURNALS, treasuryFor, type DocType } from '@shared/domain'
import { WITHHOLDING_METHOD } from '@shared/taxes'
import { todayISO } from '@shared/format'
import type { Db } from '../db'
import { audit, fail, num, str, type Ctx } from './context'

export interface EntryLine {
  account: string
  party_id?: number | null
  label?: string
  debit?: number
  credit?: number
}

interface EntryInput {
  journal: string
  date: string
  label: string
  source?: string | null
  source_id?: number | null
  lines: EntryLine[]
}

const round = (n: number) => Math.round(n * 100) / 100

async function nextEntryNumber(db: Db, journal: string, date: string): Promise<string> {
  const year = date.slice(0, 4)
  const row = await db.one<{ value: number }>(
    `INSERT INTO sequences (key, value) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1 RETURNING value`,
    [`JRN-${journal}-${year}`]
  )
  return `${journal}-${year}-${String(row!.value).padStart(5, '0')}`
}

/** Enregistre une écriture équilibrée ; renvoie son id. */
export async function postEntry(db: Db, ctx: Ctx, input: EntryInput): Promise<number> {
  const lines = input.lines
    .map((l) => ({ ...l, debit: round(l.debit ?? 0), credit: round(l.credit ?? 0) }))
    .filter((l) => l.debit !== 0 || l.credit !== 0)
  if (lines.length < 2) fail('Une écriture comporte au moins deux lignes.')
  const debit = lines.reduce((s, l) => s + l.debit, 0)
  const credit = lines.reduce((s, l) => s + l.credit, 0)
  if (Math.abs(debit - credit) > 0.005) fail(`Écriture déséquilibrée : débit ${debit}, crédit ${credit}.`)
  for (const l of lines) {
    if (l.debit < 0 || l.credit < 0) fail('Les montants au débit et au crédit doivent être positifs.')
    if (l.debit > 0 && l.credit > 0) fail('Une ligne est soit au débit, soit au crédit.')
  }
  const accounts = await db.query<{ number: string }>('SELECT number FROM accounts WHERE number = ANY($1)', [
    [...new Set(lines.map((l) => l.account))]
  ])
  const known = new Set(accounts.map((a) => a.number))
  for (const l of lines) if (!known.has(l.account)) fail(`Compte ${l.account} inconnu du plan comptable.`)

  const number = await nextEntryNumber(db, input.journal, input.date)
  const row = await db.one<{ id: number }>(
    `INSERT INTO journal_entries (journal, number, date, label, source, source_id, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [input.journal, number, input.date, input.label, input.source ?? null, input.source_id ?? null, ctx.user?.id ?? null]
  )
  let pos = 0
  for (const l of lines) {
    await db.query(
      `INSERT INTO journal_lines (entry_id, position, account, party_id, label, debit, credit)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [row!.id, pos++, l.account, l.party_id ?? null, l.label ?? input.label, l.debit, l.credit]
    )
  }
  return row!.id
}

export async function removeSourceEntry(db: Db, source: string, sourceId: number): Promise<void> {
  await db.query('DELETE FROM journal_entries WHERE source = $1 AND source_id = $2', [source, sourceId])
}

async function hasEntry(db: Db, source: string, sourceId: number): Promise<boolean> {
  return !!(await db.one('SELECT 1 FROM journal_entries WHERE source = $1 AND source_id = $2', [source, sourceId]))
}

/** Écriture d'une facture, d'un avoir ou d'une facture fournisseur validés. */
export async function postDocument(db: Db, ctx: Ctx, docId: number): Promise<void> {
  const doc = await db.one(
    `SELECT d.id, d.type, d.number, d.date, d.party_id, d.total_ht, d.total_tva, d.total_ttc, d.taxes, d.status, p.name AS party_name
     FROM documents d JOIN parties p ON p.id = d.party_id WHERE d.id = $1`,
    [docId]
  )
  if (!doc || doc.status !== 'valide') return
  const type = doc.type as DocType
  if (type !== 'FAC' && type !== 'AV' && type !== 'FF') return
  if (await hasEntry(db, 'document', docId)) return

  // Ventilation du HT : marchandises (701/601) ou services (706/605).
  const split = await db.query<{ service: boolean; ht: number }>(
    `SELECT COALESCE(p.kind = 'prestation', l.product_id IS NULL) AS service, SUM(l.total_ht) AS ht
     FROM document_lines l LEFT JOIN products p ON p.id = l.product_id
     WHERE l.document_id = $1 GROUP BY 1`,
    [docId]
  )
  const label = `${doc.number} ${doc.party_name}`
  // Taxes additionnelles (droit de timbre…) comprises dans le TTC.
  const additions = ((doc.taxes ?? []) as { kind: string; value: number; account_sale: string; account_purchase: string }[]).filter((t) => t.kind === 'addition' && t.value > 0)
  const lines: EntryLine[] = []
  if (type === 'FF') {
    for (const s of split) lines.push({ account: s.service ? '605' : '601', debit: s.ht })
    lines.push({ account: '4452', debit: doc.total_tva })
    for (const t of additions) lines.push({ account: t.account_purchase, debit: t.value })
    lines.push({ account: '401', party_id: doc.party_id, credit: doc.total_ttc })
  } else {
    const sign = type === 'FAC' ? 1 : -1
    const side = (amount: number): Pick<EntryLine, 'debit' | 'credit'> =>
      amount * sign >= 0 ? { debit: Math.abs(amount) } : { credit: Math.abs(amount) }
    lines.push({ account: '411', party_id: doc.party_id, ...side(doc.total_ttc) })
    for (const s of split) lines.push({ account: s.service ? '706' : '701', ...side(-s.ht) })
    lines.push({ account: '4431', ...side(-doc.total_tva) })
    for (const t of additions) lines.push({ account: t.account_sale, ...side(-t.value) })
  }
  await postEntry(db, ctx, { journal: type === 'FF' ? 'AC' : 'VT', date: doc.date, label, source: 'document', source_id: docId, lines })
}

/** Écriture d'un règlement : trésorerie contre compte de tiers. */
export async function postPayment(db: Db, ctx: Ctx, paymentId: number): Promise<void> {
  if (await hasEntry(db, 'payment', paymentId)) return
  const p = await db.one(
    `SELECT py.*, d.number AS document_number, d.type AS document_type, pa.name AS party_name, pa.kind AS party_kind
     FROM payments py JOIN parties pa ON pa.id = py.party_id LEFT JOIN documents d ON d.id = py.document_id
     WHERE py.id = $1`,
    [paymentId]
  )
  if (!p) return
  // Retenue à la source : compte de la taxe au lieu d'un compte de trésorerie.
  const { account, journal } = p.method === WITHHOLDING_METHOD && p.tax_account ? { account: p.tax_account as string, journal: 'OD' as const } : treasuryFor(p.method)
  const third = p.party_kind === 'supplier' ? '401' : '411'
  const label = `Règlement ${p.document_number ?? ''} ${p.party_name}`.replace(/\s+/g, ' ')
  const lines: EntryLine[] =
    p.direction === 'in'
      ? [{ account, debit: p.amount }, { account: third, party_id: p.party_id, credit: p.amount }]
      : [{ account: third, party_id: p.party_id, debit: p.amount }, { account, credit: p.amount }]
  await postEntry(db, ctx, { journal, date: p.date, label, source: 'payment', source_id: paymentId, lines })
}

/** Pièces validées ou règlements sans écriture (données antérieures au module). */
export async function missingCount(ctx: Ctx) {
  const row = await ctx.db.one<{ docs: number; pays: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM documents d WHERE d.status = 'valide' AND d.type IN ('FAC','AV','FF')
          AND NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.source = 'document' AND e.source_id = d.id)) AS docs,
       (SELECT COUNT(*)::int FROM payments p
          WHERE NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.source = 'payment' AND e.source_id = p.id)) AS pays`
  )
  return { documents: row?.docs ?? 0, payments: row?.pays ?? 0 }
}

export async function generateMissing(ctx: Ctx) {
  return ctx.db.tx(async (db) => {
    const docs = await db.query<{ id: number }>(
      `SELECT id FROM documents WHERE status = 'valide' AND type IN ('FAC','AV','FF') ORDER BY date, id`
    )
    const pays = await db.query<{ id: number }>('SELECT id FROM payments ORDER BY date, id')
    const before = await missingCount({ ...ctx, db })
    for (const d of docs) await postDocument(db, ctx, d.id)
    for (const p of pays) await postPayment(db, ctx, p.id)
    await audit(db, ctx, 'generation', 'ecritures', null, `${before.documents} pièces, ${before.payments} règlements`)
    return before
  })
}

// ---------- Consultation ----------

export async function listAccounts(ctx: Ctx) {
  return ctx.db.query(
    `SELECT a.number, a.label, a.active,
            COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
     FROM accounts a LEFT JOIN journal_lines l ON l.account = a.number
     GROUP BY a.number, a.label, a.active ORDER BY a.number`
  )
}

export async function saveAccount(ctx: Ctx, input: { number: string; label: string; active?: boolean; isNew?: boolean }) {
  const number = str(input.number)
  if (!/^[1-9]\d{1,7}$/.test(number)) fail('Numéro de compte invalide (2 à 8 chiffres, classes 1 à 9).')
  const label = str(input.label)
  if (!label) fail('Intitulé obligatoire.')
  if (input.isNew) {
    if (await ctx.db.one('SELECT 1 FROM accounts WHERE number = $1', [number])) fail('Ce compte existe déjà.')
    await ctx.db.query('INSERT INTO accounts (number, label) VALUES ($1, $2)', [number, label])
  } else {
    await ctx.db.query('UPDATE accounts SET label = $1, active = $2 WHERE number = $3', [label, input.active ?? true, number])
  }
  await audit(ctx.db, ctx, input.isNew ? 'creation' : 'modification', 'compte', null, number)
  return { number }
}

export async function listEntries(ctx: Ctx, args: { journal?: string; from?: string; to?: string; search?: string } = {}) {
  const search = `%${str(args.search).toLowerCase()}%`
  const entries = await ctx.db.query(
    `SELECT e.id, e.journal, e.number, e.date, e.label, e.source, e.source_id, u.full_name AS user_name
     FROM journal_entries e LEFT JOIN users u ON u.id = e.user_id
     WHERE ($1 = '' OR e.journal = $1) AND ($2 = '' OR e.date >= $2) AND ($3 = '' OR e.date <= $3)
       AND (lower(e.label) LIKE $4 OR lower(e.number) LIKE $4)
     ORDER BY e.date DESC, e.id DESC LIMIT 500`,
    [str(args.journal), str(args.from), str(args.to), search]
  )
  if (entries.length === 0) return []
  const lines = await ctx.db.query(
    `SELECT l.*, a.label AS account_label, p.name AS party_name
     FROM journal_lines l JOIN accounts a ON a.number = l.account LEFT JOIN parties p ON p.id = l.party_id
     WHERE l.entry_id = ANY($1) ORDER BY l.entry_id, l.position`,
    [entries.map((e) => e.id)]
  )
  const byEntry = new Map<number, any[]>()
  for (const l of lines) byEntry.set(l.entry_id, [...(byEntry.get(l.entry_id) ?? []), l])
  return entries.map((e) => ({ ...e, lines: byEntry.get(e.id) ?? [] }))
}

/** Grand livre d'un compte (ou d'une racine : « 6 », « 60 »…) avec solde progressif. */
export async function ledger(ctx: Ctx, args: { account: string; from?: string; to?: string; partyId?: number }) {
  const prefix = str(args.account)
  if (!prefix) fail('Choisissez un compte.')
  const from = str(args.from)
  const party = args.partyId ?? null
  const opening = from
    ? await ctx.db.one<{ d: number; c: number }>(
        `SELECT COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.account LIKE $1 AND e.date < $2 AND ($3::int IS NULL OR l.party_id = $3)`,
        [prefix + '%', from, party]
      )
    : { d: 0, c: 0 }
  const rows = await ctx.db.query(
    `SELECT l.id, l.account, l.label, l.debit, l.credit, e.date, e.number, e.journal, p.name AS party_name
     FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id LEFT JOIN parties p ON p.id = l.party_id
     WHERE l.account LIKE $1 AND ($2 = '' OR e.date >= $2) AND ($3 = '' OR e.date <= $3) AND ($4::int IS NULL OR l.party_id = $4)
     ORDER BY e.date, e.id, l.position LIMIT 5000`,
    [prefix + '%', from, str(args.to), party]
  )
  let balance = (opening?.d ?? 0) - (opening?.c ?? 0)
  const lines = rows.map((r) => {
    balance += r.debit - r.credit
    return { ...r, balance: round(balance) }
  })
  return { opening: round((opening?.d ?? 0) - (opening?.c ?? 0)), lines, closing: round(balance) }
}

/** Balance générale : mouvements de la période et soldes cumulés à la date de fin. */
export async function trialBalance(ctx: Ctx, args: { from?: string; to?: string } = {}) {
  return ctx.db.query(
    `SELECT a.number, a.label,
            COALESCE(SUM(CASE WHEN ($1 = '' OR e.date >= $1) THEN l.debit END), 0) AS debit,
            COALESCE(SUM(CASE WHEN ($1 = '' OR e.date >= $1) THEN l.credit END), 0) AS credit,
            COALESCE(SUM(l.debit - l.credit), 0) AS balance
     FROM accounts a
     JOIN journal_lines l ON l.account = a.number
     JOIN journal_entries e ON e.id = l.entry_id AND ($2 = '' OR e.date <= $2)
     GROUP BY a.number, a.label
     ORDER BY a.number`,
    [str(args.from), str(args.to)]
  )
}

/** Compte de résultat simplifié : produits (classe 7) moins charges (classe 6). */
export async function incomeStatement(ctx: Ctx, args: { from?: string; to?: string } = {}) {
  const rows = await ctx.db.query<{ number: string; label: string; amount: number }>(
    `SELECT a.number, a.label,
            SUM(CASE WHEN a.number LIKE '6%' THEN l.debit - l.credit ELSE l.credit - l.debit END) AS amount
     FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.number = l.account
     WHERE (a.number LIKE '6%' OR a.number LIKE '7%') AND ($1 = '' OR e.date >= $1) AND ($2 = '' OR e.date <= $2)
     GROUP BY a.number, a.label HAVING SUM(l.debit - l.credit) <> 0
     ORDER BY a.number`,
    [str(args.from), str(args.to)]
  )
  const charges = rows.filter((r) => r.number.startsWith('6'))
  const produits = rows.filter((r) => r.number.startsWith('7'))
  const totalCharges = round(charges.reduce((s, r) => s + r.amount, 0))
  const totalProduits = round(produits.reduce((s, r) => s + r.amount, 0))
  return { charges, produits, totalCharges, totalProduits, result: round(totalProduits - totalCharges) }
}

// ---------- Saisie manuelle ----------

export async function saveManualEntry(ctx: Ctx, input: { journal?: string; date?: string; label: string; lines: EntryLine[] }) {
  const journal = str(input.journal) || 'OD'
  if (!(journal in JOURNALS)) fail('Journal inconnu.')
  const date = str(input.date) || todayISO()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Date invalide.')
  const label = str(input.label)
  if (!label) fail("Libellé de l'écriture obligatoire.")
  const lines = (input.lines ?? []).map((l) => ({
    account: str(l.account),
    party_id: l.party_id ? Number(l.party_id) : null,
    label: str(l.label) || label,
    debit: num(l.debit),
    credit: num(l.credit)
  }))
  return ctx.db.tx(async (db) => {
    const id = await postEntry(db, ctx, { journal, date, label, lines })
    await audit(db, ctx, 'creation', 'ecriture', id, label)
    return { id }
  })
}

export async function deleteManualEntry(ctx: Ctx, args: { id: number }) {
  return ctx.db.tx(async (db) => {
    const e = await db.one('SELECT source, number FROM journal_entries WHERE id = $1', [args.id])
    if (!e) fail('Écriture introuvable.')
    if (e.source) fail('Écriture générée automatiquement : corrigez la pièce d’origine (avoir, suppression du règlement…).')
    await db.query('DELETE FROM journal_entries WHERE id = $1', [args.id])
    await audit(db, ctx, 'suppression', 'ecriture', args.id, e.number)
    return true
  })
}
