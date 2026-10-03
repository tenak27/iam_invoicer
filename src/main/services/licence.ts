// Vérification et activation des licences. Sans licence : évaluation complète de
// 30 jours, puis lecture seule (consultation, impression et export restent possibles).

import { createPublicKey, verify } from 'node:crypto'
import { PERMISSIONS, type Module } from '@shared/domain'
import {
  BASE_MODULES, LICENCE_PUBLIC_KEY, MODULE_NAMES, normalizeCompany, TIERS, TRIAL_DAYS, VENDOR,
  type LicencePayload, type LicenceStatus
} from '@shared/licence'
import { todayISO } from '@shared/format'
import type { Db } from '../db'
import { audit, fail, type Ctx } from './context'

const ALL_MODULES = PERMISSIONS.admin as Module[]
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
      ? { state: 'trial', label: 'Évaluation', tier: 'trial', modules: ALL_MODULES, users: 0, expires: null, daysLeft: trialLeft, company, licenceId: null, whiteLabel: false, canWrite: true, message }
      : { state: 'trial_over', label: 'Évaluation terminée', tier: 'trial', modules: ALL_MODULES, users: 0, expires: null, daysLeft: 0, company, licenceId: null, whiteLabel: false, canWrite: false, message: `Période d'évaluation terminée : vos données restent consultables. Activez une licence pour continuer (${contact}).` }

  if (!key) return trial(`Évaluation complète : ${Math.max(trialLeft, 0)} jour(s) restant(s). Contact : ${contact}.`)
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

/** Contrôle d'un appel : module inclus dans la licence, écriture autorisée. */
export async function enforceLicence(db: Db, name: string, module: Module | null, readOnly: boolean) {
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

export async function getLicence(ctx: Ctx) {
  return licenceStatus(ctx.db)
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
