// Paramétrage des taxes de facturation (hors TVA des lignes) : taxes additionnelles
// et retenues à la source. Les documents gardent une copie des taxes appliquées :
// modifier ou supprimer une taxe ne change pas les documents déjà établis.

import { countryProfile } from '@shared/countries'
import { taxPresets, type TaxDef, type TaxSide } from '@shared/taxes'
import type { Db } from '../db'
import { audit, fail, type Ctx } from './context'
import { getSettings } from './settings'

const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown) => String(v ?? '').trim()

export async function listTaxes(ctx: Ctx, args: { activeOnly?: boolean; side?: 'sale' | 'purchase' } = {}): Promise<(TaxDef & { id: number })[]> {
  return ctx.db.query(
    `SELECT id, code, label, kind, base, rate, amount, account_sale, account_purchase, applies_to, auto, active
     FROM taxes WHERE ($1 = false OR active) AND ($2 = '' OR applies_to = 'both' OR applies_to = $2)
     ORDER BY position, id`,
    [!!args.activeOnly, args.side ?? '']
  )
}

async function checkAccount(db: Db, account: string, what: string) {
  if (!account) return
  if (!(await db.one('SELECT 1 FROM accounts WHERE number = $1', [account]))) fail(`Compte ${account} (${what}) inconnu du plan comptable : créez-le d'abord dans Comptabilité → Plan comptable.`)
}

export async function saveTax(ctx: Ctx, input: any) {
  return ctx.db.tx(async (db) => {
    const t = {
      code: str(input.code).toUpperCase().replace(/\s+/g, '-'),
      label: str(input.label),
      kind: input.kind === 'withholding' ? 'withholding' : 'addition',
      base: ['ht', 'tva', 'ttc', 'fixed'].includes(input.base) ? input.base : 'ht',
      rate: num(input.rate),
      amount: Math.round(num(input.amount)),
      account_sale: str(input.account_sale),
      account_purchase: str(input.account_purchase),
      applies_to: (['sale', 'purchase', 'both'].includes(input.applies_to) ? input.applies_to : 'both') as TaxSide,
      auto: input.kind !== 'withholding' && !!input.auto,
      active: input.active !== false
    }
    if (!t.code) fail('Saisissez un code (ex. TIMBRE).')
    if (!t.label) fail('Saisissez un libellé.')
    if (t.base === 'fixed' ? t.amount < 0 : t.rate < 0 || t.rate > 100) fail('Taux entre 0 et 100 %.')
    if (t.applies_to !== 'purchase' && !t.account_sale) fail('Indiquez le compte utilisé sur les ventes.')
    if (t.applies_to !== 'sale' && !t.account_purchase) fail('Indiquez le compte utilisé sur les achats.')
    await checkAccount(db, t.account_sale, 'ventes')
    await checkAccount(db, t.account_purchase, 'achats')
    const dup = await db.one('SELECT id FROM taxes WHERE code = $1', [t.code])
    if (dup && dup.id !== Number(input.id)) fail(`Le code ${t.code} existe déjà.`)
    const values = [t.code, t.label, t.kind, t.base, t.rate, t.amount, t.account_sale, t.account_purchase, t.applies_to, t.auto, t.active]
    if (input.id) {
      await db.query(
        `UPDATE taxes SET code=$1, label=$2, kind=$3, base=$4, rate=$5, amount=$6, account_sale=$7, account_purchase=$8, applies_to=$9, auto=$10, active=$11 WHERE id=$12`,
        [...values, Number(input.id)]
      )
      await audit(db, ctx, 'modification', 'taxe', Number(input.id), t.code)
      return { id: Number(input.id) }
    }
    const row = await db.one<{ id: number }>(
      `INSERT INTO taxes (code, label, kind, base, rate, amount, account_sale, account_purchase, applies_to, auto, active, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, (SELECT COALESCE(MAX(position), 0) + 1 FROM taxes)) RETURNING id`,
      values
    )
    await audit(db, ctx, 'creation', 'taxe', row!.id, t.code)
    return { id: row!.id }
  })
}

export async function deleteTax(ctx: Ctx, args: { id: number }) {
  const t = await ctx.db.one('SELECT code FROM taxes WHERE id = $1', [args.id])
  if (!t) fail('Taxe introuvable.')
  await ctx.db.query('DELETE FROM taxes WHERE id = $1', [args.id])
  await audit(ctx.db, ctx, 'suppression', 'taxe', args.id, t.code)
  return true
}

/** Ajoute les modèles de taxes du pays de la société (inactifs, à vérifier puis activer). */
export async function importTaxPresets(ctx: Ctx) {
  const s = await getSettings(ctx.db)
  let added = 0
  for (const p of taxPresets(countryProfile(s.country_code, s.country).code)) {
    if (await ctx.db.one('SELECT 1 FROM taxes WHERE code = $1', [p.code])) continue
    await saveTax(ctx, p)
    added++
  }
  return added
}

/** Taxes à appliquer à un document : codes choisis, ou taxes automatiques pour un nouveau document. */
export async function resolveTaxes(db: Db, side: 'sale' | 'purchase', codes: unknown): Promise<TaxDef[]> {
  const all = await listTaxes({ db, user: null }, { activeOnly: true, side })
  if (Array.isArray(codes)) {
    const wanted = new Set(codes.map((c) => String(typeof c === 'object' && c ? (c as any).code : c)))
    return all.filter((t) => wanted.has(t.code))
  }
  return all.filter((t) => t.auto && t.kind === 'addition')
}
