import type { Db } from '../db'
import { audit, type Ctx } from './context'

export interface CompanySettings {
  name: string
  legal_form: string
  activity: string
  address: string
  city: string
  country: string
  phone: string
  email: string
  website: string
  rccm: string
  tax_id_label: string
  tax_id: string
  /** Burkina Faso : RNI, RSI ou CME. */
  regime_fiscal: string
  /** Service des impôts de rattachement (DGE, DME, CME de la ville…). */
  division_fiscale: string
  capital: string
  bank_name: string
  bank_account: string
  logo: string // data URL
  invoice_footer: string
  currency: string
  default_tva: number
  payment_terms: number
  allow_negative_stock: boolean
}

export const DEFAULT_SETTINGS: CompanySettings = {
  name: 'IAM Technology',
  legal_form: 'SARL',
  activity: '',
  address: '',
  city: 'Ouagadougou',
  country: 'Burkina Faso',
  phone: '',
  email: '',
  website: '',
  rccm: '',
  tax_id_label: 'IFU',
  tax_id: '',
  regime_fiscal: '',
  division_fiscale: '',
  capital: '',
  bank_name: '',
  bank_account: '',
  logo: '',
  invoice_footer: 'Merci pour votre confiance.',
  currency: 'FCFA',
  default_tva: 18,
  payment_terms: 30,
  allow_negative_stock: false
}

export async function getSettings(db: Db): Promise<CompanySettings> {
  const rows = await db.query<{ key: string; value: string }>('SELECT key, value FROM settings')
  const out: any = { ...DEFAULT_SETTINGS }
  for (const r of rows) if (r.key in out) out[r.key] = JSON.parse(r.value)
  return out
}

export async function saveSettings(ctx: Ctx, input: Partial<CompanySettings>): Promise<CompanySettings> {
  await ctx.db.tx(async (db) => {
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof CompanySettings)[]) {
      if (!(key in input)) continue
      await db.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [key, JSON.stringify(input[key])]
      )
    }
    await audit(db, ctx, 'modification', 'parametres', null)
  })
  return getSettings(ctx.db)
}
