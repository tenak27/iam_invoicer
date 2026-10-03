// Vérification et activation des licences. Sans licence : évaluation de 30 jours,
// tous modules mais en quantités limitées (TRIAL_LIMITS) et documents marqués
// « évaluation », puis lecture seule (consultation, impression et export restent possibles).

import { createPublicKey, verify } from 'node:crypto'
import { PERMISSIONS, type Module } from '@shared/domain'
import {
  BASE_MODULES, LICENCE_PUBLIC_KEY, MODULE_NAMES, normalizeCompany, TIERS, TRIAL_DAYS, TRIAL_LIMITS, TRIAL_QUOTA_LABELS, VENDOR,
  type LicencePayload, type LicenceStatus, type TrialQuota, type TrialUsage
} from '@shared/licence'
import { todayISO } from '@shared/format'
import type { Db } from '../db'
import { audit, fail, type Ctx } from './context'
import { vendorKeyAvailable } from './licensing'

// Émission de licences : hors licence client, réservée au poste de l'éditeur
const ALL_MODULES: Module[] = PERMISSIONS.admin.filter((m) => m !== 'licensing')
let publicKey = createPublicKey(LICENCE_PUBLIC_KEY)
const decoded = new Map<string, LicencePayload | null>()

/** Tests automatisés uniquement : vérifier avec une clé de test (aucun réglage ne permet de le faire). */
export function useTestLicenceKey(pem: string) {
  publicKey = createPublicKey(pem)
  decoded.clear()
}

/** Licence → contenu si la signature de l'éditeur est valide, sinon null. */
export function decodeLicence(key: string): LicencePayload | null {
  const k = String(key ?? '').replace(/\s+/g, '')
  if (decoded.has(k)) return decoded.get(k)!
  let out: LicencePayload | null = null
  try {
    const [data, sig] = k.split('.')
    if (data && sig && verify(null, Buffer.from(data), publicKey, Buffer.from(sig, 'base64url'))) {
      const p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
      if (p?.v === 1 && typeof p.company === 'string' && Array.isArray(p.modules)) out = p
    }
  } catch {
    out = null
  }
  decoded.set(k, out)
  return out
}

async function readSetting(db: Db, key: string): Promise<string> {
  const r = await db.one<{ value: string }>('SELECT value FROM settings WHERE key = $1', [key])
  try {
    return r ? String(JSON.parse(r.value) ?? '') : ''
  } catch {
    return ''
  }
}
async function writeSetting(db: Db, key: string, value: string) {
  await db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value)])
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000)

const cache = new WeakMap<Db, { at: number; status: LicenceStatus }>()
export function forgetLicenceStatus(db: Db) {
  cache.delete(db)
}

export async function licenceStatus(db: Db): Promise<LicenceStatus> {
  const hit = cache.get(db)
  if (hit && Date.now() - hit.at < 5000) return hit.status
  const status = await computeStatus(db)
  cache.set(db, { at: Date.now(), status })
  return status
}

async function computeStatus(db: Db): Promise<LicenceStatus> {
  const today = todayISO()
  const [key, company, taxId] = await Promise.all([readSetting(db, 'licence_key'), readSetting(db, 'name'), readSetting(db, 'tax_id')])
  let trialStart = await readSetting(db, 'trial_start')
  if (!trialStart) {
    trialStart = today
    await writeSetting(db, 'trial_start', trialStart)
  }
  const contact = [VENDOR.name, VENDOR.phone, VENDOR.email].filter(Boolean).join(' · ')
  const trialLeft = TRIAL_DAYS - daysBetween(trialStart, today)
  const trial = (message: string): LicenceStatus =>
    trialLeft > 0
      ? { state: 'trial', label: 'Évaluation', tier: 'trial', modules: ALL_MODULES, users: TRIAL_LIMITS.users, expires: null, daysLeft: trialLeft, company, licenceId: null, whiteLabel: false, canWrite: true, message }
      : { state: 'trial_over', label: 'Évaluation terminée', tier: 'trial', modules: ALL_MODULES, users: 0, expires: null, daysLeft: 0, company, licenceId: null, whiteLabel: false, canWrite: false, message: `Période d'évaluation terminée : vos données restent consultables. Activez une licence pour continuer (${contact}).` }

  if (!key) {
    const st = trial(`Évaluation : ${Math.max(trialLeft, 0)} jour(s) restant(s), quantités limitées. Contact : ${contact}.`)
    return st.state === 'trial' ? { ...st, usage: await trialUsage(db) } : st
  }
  const lic = decodeLicence(key)
  if (!lic) return { ...trial('La licence enregistrée est invalide.'), state: trialLeft > 0 ? 'trial' : 'invalid' }
  if (normalizeCompany(lic.company) !== normalizeCompany(company) || (lic.taxId && taxId && lic.taxId.replace(/\s/g, '') !== taxId.replace(/\s/g, '')))
    return { ...trial(`Cette licence est établie pour « ${lic.company} » : vérifiez la raison sociale et l'identifiant fiscal de la société.`), state: trialLeft > 0 ? 'trial' : 'invalid' }

  const modules = [...new Set([...BASE_MODULES, ...lic.modules])].filter((m) => ALL_MODULES.includes(m))
  const label = lic.tier === 'sur-mesure' ? 'Sur mesure' : TIERS[lic.tier]?.label ?? lic.tier
  const daysLeft = lic.expires ? daysBetween(today, lic.expires) : null
  const base = { label, tier: lic.tier, modules, users: lic.users, expires: lic.expires, daysLeft, company: lic.company, licenceId: lic.id, whiteLabel: lic.whiteLabel }
  if (daysLeft !== null && daysLeft < 0)
    return { ...base, state: 'expired', canWrite: false, message: `Licence ${label} expirée le ${lic.expires} : vos données restent consultables. Renouvelez-la auprès de ${contact}.` }
  return {
    ...base,
    state: 'active',
    canWrite: true,
    message: daysLeft !== null && daysLeft <= 30 ? `Licence ${label} : expire dans ${daysLeft} jour(s). Pensez à la renouveler (${contact}).` : `Licence ${label} active.`
  }
}

const QUOTA_SQL: Record<Exclude<TrialQuota, 'users'>, string> = {
  documents: 'SELECT COUNT(*)::int AS n FROM documents',
  clients: "SELECT COUNT(*)::int AS n FROM parties WHERE kind = 'client'",
  suppliers: "SELECT COUNT(*)::int AS n FROM parties WHERE kind = 'supplier'",
  products: 'SELECT COUNT(*)::int AS n FROM products',
  employees: 'SELECT COUNT(*)::int AS n FROM employees'
}
async function countOf(db: Db, q: TrialQuota): Promise<number> {
  const sql = q === 'users' ? 'SELECT COUNT(*)::int AS n FROM users WHERE active' : QUOTA_SQL[q]
  return (await db.one<{ n: number }>(sql))!.n
}
async function trialUsage(db: Db): Promise<TrialUsage[]> {
  const keys = Object.keys(TRIAL_LIMITS) as TrialQuota[]
  const used = await Promise.all(keys.map((k) => countOf(db, k)))
  return keys.map((k, i) => ({ key: k, label: TRIAL_QUOTA_LABELS[k], used: used[i], limit: TRIAL_LIMITS[k] }))
}

/** Création demandée par un appel, au regard des quotas d'évaluation (null : rien de créé). */
export function trialDemand(name: string, args: any): { quota: TrialQuota; add: number } | null {
  const isNew = !args?.id
  switch (name) {
    case 'documents.save': return isNew ? { quota: 'documents', add: 1 } : null
    case 'documents.convert':
    case 'documents.duplicate':
    case 'cash.sale':
    case 'recurring.runDue': return { quota: 'documents', add: 1 }
    case 'parties.save': return isNew ? { quota: args?.kind === 'supplier' ? 'suppliers' : 'clients', add: 1 } : null
    case 'products.save': return isNew ? { quota: 'products', add: 1 } : null
    case 'hr.saveEmployee': return isNew ? { quota: 'employees', add: 1 } : null
    case 'imports.run': {
      const q = ({ clients: 'clients', suppliers: 'suppliers', products: 'products', employees: 'employees' } as Record<string, TrialQuota>)[args?.kind]
      return q ? { quota: q, add: Array.isArray(args?.rows) ? args.rows.length : 1 } : null
    }
    default: return null
  }
}

/** Évaluation : refuse une création au-delà des quantités autorisées. */
export async function enforceTrialQuota(db: Db, name: string, args: unknown) {
  const d = trialDemand(name, args)
  if (!d) return
  const st = await licenceStatus(db)
  if (st.state !== 'trial') return
  const limit = TRIAL_LIMITS[d.quota]
  const used = await countOf(db, d.quota)
  if (used + d.add > limit) {
    const contact = [VENDOR.name, VENDOR.phone, VENDOR.email].filter(Boolean).join(' · ')
    fail(`Version d'évaluation limitée à ${limit} ${TRIAL_QUOTA_LABELS[d.quota]} (${used} déjà utilisé${used > 1 ? 's' : ''}). Activez une licence pour continuer sans limite : ${contact}.`)
  }
}

/** Contrôle d'un appel : module inclus dans la licence, écriture autorisée. */
export async function enforceLicence(db: Db, name: string, module: Module | null, readOnly: boolean) {
  // Émission de licences : hors licence client ; l'émission elle-même exige la clé privée (licensing.ts)
  if (module === 'licensing') return
  const st = await licenceStatus(db)
  if (module && !st.modules.includes(module))
    fail(`Le module « ${MODULE_NAMES[module]} » n'est pas inclus dans votre licence ${st.label}. Contactez ${VENDOR.name} pour l'ajouter.`)
  if (!readOnly && !st.canWrite) fail(st.message)
}

/** Nombre d'utilisateurs actifs autorisé par la licence. */
export async function checkUserQuota(db: Db, excludeUserId?: number) {
  const st = await licenceStatus(db)
  if (!st.users) return
  const row = await db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM users WHERE active AND ($1::int IS NULL OR id <> $1)', [excludeUserId ?? null])
  if (row!.n >= st.users) fail(`Votre licence ${st.label} est limitée à ${st.users} utilisateur(s) actif(s). Désactivez un compte ou passez au palier supérieur.`)
}

export async function getLicence(ctx: Ctx): Promise<LicenceStatus> {
  return { ...(await licenceStatus(ctx.db)), vendor: vendorKeyAvailable() }
}

export async function activateLicence(ctx: Ctx, args: { key: string }) {
  const key = String(args?.key ?? '').replace(/\s+/g, '')
  const lic = decodeLicence(key)
  if (!lic) fail('Clé de licence invalide : copiez-la en entier, sans la modifier.')
  const company = await readSetting(ctx.db, 'name')
  if (normalizeCompany(lic.company) !== normalizeCompany(company))
    fail(`Cette licence est établie pour « ${lic.company} » alors que la société configurée est « ${company} ». Corrigez la raison sociale ou demandez une licence à ce nom.`)
  await writeSetting(ctx.db, 'licence_key', key)
  forgetLicenceStatus(ctx.db)
  await audit(ctx.db, ctx, 'activation', 'licence', null, `${lic.id} ${lic.tier}`)
  return licenceStatus(ctx.db)
}
