import type { Db } from '../db'
import { audit, fail, type Ctx } from './context'
import { forgetLicenceStatus } from './licence'

export interface CompanySettings {
  name: string
  legal_form: string
  activity: string
  address: string
  city: string
  country: string
  /** Code du profil pays (BF, CI, SN…), voir src/shared/countries.ts. */
  country_code: string
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
  /** Taux de l'impôt sur les bénéfices (BIC / IS), en % — vide = taux du pays. */
  is_rate: number
  payment_terms: number
  allow_negative_stock: boolean

  // Modèles de documents
  doc_color: string
  doc_layout: 'classique' | 'moderne'
  doc_terms: string
  doc_show_stamp: boolean
  /** Marges des documents A4, en millimètres. */
  doc_margin_top: number
  doc_margin_side: number
  doc_margin_bottom: number
  /** Colonne « N° » sur les lignes des documents. */
  doc_line_numbers: boolean
  stamp: string // cachet de la société (data URL)
  signature_image: string // signature du responsable (data URL)
  signatory_name: string
  signatory_title: string

  // Messagerie (le mot de passe est dans la table secrets)
  smtp_host: string
  smtp_port: number
  smtp_secure: boolean
  smtp_user: string
  smtp_from_name: string
  smtp_from_email: string

  // SMS (la clé secrète est dans la table secrets)
  sms_provider: '' | 'orange' | 'twilio' | 'http'
  sms_sender: string
  sms_account: string
  sms_http_url: string

  /** Adresse publique du serveur pour les liens de signature (https://facturation.iam.bf). */
  public_url: string

  // Facture électronique certifiée (SECeF) — le jeton est dans la table secrets
  secef_mode: '' | 'simulation' | 'api'
  secef_url: string
  secef_nim: string
}

/** Images de la société, insérées dans les documents. */
const IMAGE_KEYS = ['logo', 'stamp', 'signature_image'] as const
const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|svg\+xml|webp|gif);base64,[A-Za-z0-9+/=]+$/

/** Clés gérées par le module de licence uniquement. */
export const PROTECTED_KEYS = ['licence_key', 'trial_start'] as const

/** Clés secrètes : stockées à part, jamais renvoyées à l'interface. */
export const SECRET_KEYS = ['smtp_password', 'sms_secret', 'secef_token'] as const
export type SecretKey = (typeof SECRET_KEYS)[number]

export const DEFAULT_SETTINGS: CompanySettings = {
  name: '',
  legal_form: 'SARL',
  activity: '',
  address: '',
  city: 'Ouagadougou',
  country: 'Burkina Faso',
  country_code: '',
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
  is_rate: 0,
  payment_terms: 30,
  allow_negative_stock: false,
  doc_color: '#1d6fd6',
  doc_layout: 'moderne',
  doc_terms: '',
  doc_show_stamp: true,
  doc_margin_top: 14,
  doc_margin_side: 14,
  doc_margin_bottom: 22,
  doc_line_numbers: true,
  stamp: '',
  signature_image: '',
  signatory_name: '',
  signatory_title: 'Le Directeur',
  smtp_host: '',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: '',
  smtp_from_name: '',
  smtp_from_email: '',
  sms_provider: '',
  sms_sender: '',
  sms_account: '',
  sms_http_url: '',
  public_url: '',
  secef_mode: '',
  secef_url: '',
  secef_nim: ''
}

export async function getSecret(db: Db, key: SecretKey): Promise<string> {
  const row = await db.one<{ value: string }>('SELECT value FROM secrets WHERE key = $1', [key])
  return row?.value ?? ''
}

/** Indique seulement quels secrets sont renseignés. */
export async function secretStatus(ctx: Ctx) {
  const rows = await ctx.db.query<{ key: string }>("SELECT key FROM secrets WHERE value <> ''")
  return Object.fromEntries(SECRET_KEYS.map((k) => [k, rows.some((r) => r.key === k)]))
}

export async function saveSecrets(ctx: Ctx, input: Partial<Record<SecretKey, string>>) {
  for (const key of SECRET_KEYS) {
    if (typeof input[key] !== 'string') continue
    await ctx.db.query(
      'INSERT INTO secrets (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, input[key]]
    )
  }
  await audit(ctx.db, ctx, 'modification', 'secrets', null)
  return secretStatus(ctx)
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
      // La licence et la date d'évaluation ne se modifient pas par les paramètres.
      if ((PROTECTED_KEYS as readonly string[]).includes(key)) continue
      // Images (logo, cachet, signature) : uniquement des images encodées, jamais du texte inséré tel quel dans les documents.
      if ((IMAGE_KEYS as readonly string[]).includes(key) && input[key] && !IMAGE_DATA_URL.test(String(input[key]))) fail('Image invalide : choisissez un fichier PNG, JPG, SVG ou WebP.')
      await db.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [key, JSON.stringify(input[key])]
      )
    }
    await audit(db, ctx, 'modification', 'parametres', null)
  })
  forgetLicenceStatus(ctx.db)
  return getSettings(ctx.db)
}
