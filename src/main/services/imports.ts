// Import de données (Excel / CSV déjà lus par l'interface) : chaque ligne passe par
// les mêmes contrôles qu'une saisie à l'écran. Une ligne en erreur n'empêche pas
// les autres : le compte rendu indique les lignes créées, mises à jour ou refusées.

import { can } from '@shared/domain'
import { importDefs, type ImportKind } from '@shared/imports'
import { saveAccount } from './accounting'
import { AppError, fail, type Ctx } from './context'
import { saveEmployee } from './hr'
import { saveParty } from './parties'
import { saveProduct } from './products'
import { adjustStock } from './stock'

const MAX_ROWS = 5000

/** Nombre « à la française » : espaces de milliers, virgule décimale, symbole monétaire. */
export function parseNumber(v: unknown): number | null {
  const s = String(v ?? '').replace(/[\s  ]/g, '').replace(/(fcfa|cfa|f|xof|xaf|%)$/i, '')
  if (!s) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

/** Date AAAA-MM-JJ, JJ/MM/AAAA ou numéro de série Excel → AAAA-MM-JJ. */
export function parseDate(v: unknown): string {
  const s = String(v ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s)
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3]
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  if (/^\d{5}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000)
    return d.toISOString().slice(0, 10)
  }
  return s
}

function numberField(row: Record<string, string>, key: string, label: string, opts: { min?: number } = {}): number | undefined {
  if (!(key in row) || row[key] === '') return undefined
  const n = parseNumber(row[key])
  if (n === null) return undefined
  if (Number.isNaN(n)) fail(`${label} : « ${row[key]} » n'est pas un nombre.`)
  if (opts.min !== undefined && n! < opts.min) fail(`${label} doit être supérieur ou égal à ${opts.min}.`)
  return n!
}

const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''))

export interface ImportReport {
  created: number
  updated: number
  errors: { line: number; message: string }[]
}

export async function runImport(ctx: Ctx, args: { kind: ImportKind; rows: Record<string, string>[] }): Promise<ImportReport> {
  const def = importDefs().find((d) => d.kind === args.kind)
  if (!def) fail("Type d'import inconnu.")
  if (!ctx.user || !can(ctx.user.role, def.module)) throw new AppError("Vous n'avez pas accès à ce type de données.")
  const rows = Array.isArray(args.rows) ? args.rows : []
  if (!rows.length) fail('Le fichier ne contient aucune ligne de données.')
  if (rows.length > MAX_ROWS) fail(`${MAX_ROWS} lignes au maximum par import : découpez le fichier.`)

  const report: ImportReport = { created: 0, updated: 0, errors: [] }
  const warehouses = args.kind === 'stock' ? await ctx.db.query<{ id: number; code: string }>('SELECT id, code FROM warehouses WHERE active') : []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? {}
    const line = i + 2 // ligne 1 = en-têtes
    try {
      for (const c of def.columns) if (c.required && !String(row[c.key] ?? '').trim()) fail(`colonne « ${c.label} » obligatoire.`)
      if (args.kind === 'clients' || args.kind === 'suppliers') {
        const kind = args.kind === 'clients' ? 'client' : 'supplier'
        const existing = row.code
          ? await ctx.db.one('SELECT * FROM parties WHERE kind = $1 AND code = $2', [kind, row.code])
          : await ctx.db.one('SELECT * FROM parties WHERE kind = $1 AND lower(name) = lower($2)', [kind, row.name])
        const terms = numberField(row, 'payment_terms', 'Délai de paiement', { min: 0 })
        await saveParty(ctx, { ...(existing ?? {}), ...defined({ ...row, payment_terms: terms }), kind, id: existing?.id })
        existing ? report.updated++ : report.created++
      } else if (args.kind === 'products') {
        const existing = row.ref ? await ctx.db.one('SELECT * FROM products WHERE ref = $1', [row.ref]) : null
        const kindText = (row.kind ?? '').toLowerCase()
        const kind = /presta|service/.test(kindText) ? 'prestation' : kindText ? 'produit' : existing?.kind ?? 'produit'
        await saveProduct(ctx, {
          ...(existing ?? {}),
          ...defined({
            ...row,
            sale_price: numberField(row, 'sale_price', 'Prix de vente', { min: 0 }),
            purchase_price: numberField(row, 'purchase_price', "Prix d'achat", { min: 0 }),
            tva_rate: numberField(row, 'tva_rate', 'TVA', { min: 0 }),
            min_stock: numberField(row, 'min_stock', 'Stock minimum', { min: 0 })
          }),
          tva_rate: numberField(row, 'tva_rate', 'TVA', { min: 0 }) ?? existing?.tva_rate ?? 18,
          kind,
          id: existing?.id
        })
        existing ? report.updated++ : report.created++
      } else if (args.kind === 'stock') {
        const product = await ctx.db.one('SELECT id, kind, tracking FROM products WHERE ref = $1', [row.ref])
        if (!product) fail(`article « ${row.ref} » introuvable (importez d'abord les articles).`)
        if (product.kind !== 'produit') fail(`« ${row.ref} » est une prestation : pas de stock.`)
        if (product.tracking !== 'aucun') fail(`« ${row.ref} » est suivi par lot ou numéro de série : saisissez son stock dans Dépôts, transferts, lots.`)
        const qty = numberField(row, 'quantity', 'Quantité')
        if (!qty) fail('quantité nulle ou absente.')
        const wh = row.warehouse ? warehouses.find((w) => w.code.toLowerCase() === row.warehouse.toLowerCase()) : warehouses.find((w) => w.id === 1) ?? warehouses[0]
        if (!wh) fail(`dépôt « ${row.warehouse} » inconnu.`)
        await adjustStock(ctx, { productId: product.id, quantity: qty!, unitCost: numberField(row, 'unit_cost', 'Coût unitaire', { min: 0 }), note: 'Reprise du stock (import)', warehouseId: wh!.id })
        report.created++
      } else if (args.kind === 'employees') {
        const existing = row.matricule ? await ctx.db.one('SELECT * FROM employees WHERE matricule = $1', [row.matricule]) : null
        const cat = (row.category ?? '').toLowerCase()
        await saveEmployee(ctx, {
          ...(existing ?? {}),
          ...defined({
            ...row,
            hire_date: row.hire_date ? parseDate(row.hire_date) : undefined,
            category: cat ? (cat.startsWith('cadre') ? 'cadre' : 'non_cadre') : undefined,
            base_salary: numberField(row, 'base_salary', 'Salaire de base', { min: 1 }),
            housing: numberField(row, 'housing', 'Indemnité de logement', { min: 0 }),
            transport: numberField(row, 'transport', 'Indemnité de transport', { min: 0 }),
            family_charges: numberField(row, 'family_charges', 'Charges de famille', { min: 0 })
          }),
          id: existing?.id
        })
        existing ? report.updated++ : report.created++
      } else if (args.kind === 'accounts') {
        const existing = await ctx.db.one('SELECT number FROM accounts WHERE number = $1', [row.number])
        await saveAccount(ctx, { number: row.number, label: row.label, isNew: !existing })
        existing ? report.updated++ : report.created++
      }
    } catch (e) {
      if (!(e instanceof AppError)) throw e
      report.errors.push({ line, message: e.message })
    }
  }
  return report
}
