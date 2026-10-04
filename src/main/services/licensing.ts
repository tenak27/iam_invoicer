// Émission des licences clients depuis l'application (profil « Gestionnaire de licences »).
// Fonctionne uniquement là où se trouve la clé PRIVÉE de l'éditeur : poste de l'éditeur
// (~/.iam-invoicer/licence-private.pem) ou serveur (LICENCE_PRIVATE_KEY_FILE). La clé
// n'est jamais transmise à l'interface ; elle doit correspondre à la clé publique du logiciel.
// Chaque licence est inscrite au registre de la base et au registre CSV de l'outil en ligne
// de commande (tools/licence/issue.mjs), pour que les deux numérotations restent cohérentes.

import { createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Module } from '@shared/domain'
import { LICENCE_PUBLIC_KEY, MODULE_NAMES, TIERS, type LicencePayload, type Tier } from '@shared/licence'
import { todayISO } from '@shared/format'
import { audit, fail, type Ctx } from './context'

let keyPath: string | null = null
let expectedPublic = LICENCE_PUBLIC_KEY.trim()
let cached: { path: string; mtime: number; key: KeyObject | null; reason: string } | null = null

/** Tests automatisés uniquement : clé publique de test (voir useTestLicenceKey). */
export function useTestVendorPublicKey(pem: string) {
  expectedPublic = pem.trim()
  cached = null
}

/** Chemin de la clé privée de l'éditeur (appelé au démarrage du poste ou du serveur). */
export function configureVendorKey(path: string | null | undefined) {
  keyPath = path || null
  cached = null
}

function loadKey(): { key: KeyObject | null; reason: string } {
  if (!keyPath) return { key: null, reason: 'Aucune clé privée configurée.' }
  if (!existsSync(keyPath)) return { key: null, reason: `Clé privée introuvable : ${keyPath}` }
  const { mtimeMs } = statSync(keyPath)
  if (cached && cached.path === keyPath && cached.mtime === mtimeMs) return cached
  let key: KeyObject | null = null
  let reason = ''
  try {
    key = createPrivateKey(readFileSync(keyPath))
    // La clé doit correspondre à la clé publique intégrée au logiciel, sinon les licences seraient refusées
    const pub = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString().trim()
    if (pub !== expectedPublic) {
      key = null
      reason = 'La clé privée ne correspond pas à la clé publique du logiciel.'
    }
  } catch {
    key = null
    reason = 'Clé privée illisible.'
  }
  cached = { path: keyPath, mtime: mtimeMs, key, reason }
  return cached
}

export function vendorKeyAvailable(): boolean {
  return !!loadKey().key
}

const registryPath = () => (keyPath ? join(dirname(keyPath), 'licences.csv') : null)
const CSV_HEADER = '﻿Numéro;Date;Client;IFU;Palier;Utilisateurs;Expire;Marque blanche;Licence\r\n'

function csvNumbers(): string[] {
  const p = registryPath()
  if (!p || !existsSync(p)) return []
  return readFileSync(p, 'utf8').split(/\r?\n/).slice(1).map((l) => l.split(';')[0]).filter(Boolean)
}

/** Lecture simple du CSV (champs entre guillemets possibles). */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ';') { out.push(cur); cur = '' } else cur += c
  }
  out.push(cur)
  return out
}

export async function vendorStatus(_ctx: Ctx) {
  const { key, reason } = loadKey()
  const reg = registryPath()
  return {
    available: !!key,
    reason: key ? null : reason,
    registry: reg && existsSync(reg) ? reg : null,
    tiers: Object.entries(TIERS).map(([id, t]) => ({ id, label: t.label, pitch: t.pitch, users: t.users, whiteLabel: t.whiteLabel, modules: t.modules })),
    modules: (Object.keys(MODULE_NAMES) as Module[]).filter((m) => m !== 'licensing').map((m) => ({ id: m, label: MODULE_NAMES[m] }))
  }
}

export async function listIssued(ctx: Ctx) {
  return ctx.db.query(
    `SELECT l.*, u.full_name AS issued_by_name FROM licences_issued l LEFT JOIN users u ON u.id = l.issued_by
     ORDER BY l.created_at DESC, l.id DESC`
  )
}

async function nextNumber(ctx: Ctx, year: string): Promise<string> {
  const db = (await ctx.db.query<{ number: string }>("SELECT number FROM licences_issued WHERE number LIKE $1", [`LIC-${year}-%`])).map((r) => r.number)
  const all = [...db, ...csvNumbers().filter((n) => n.startsWith(`LIC-${year}-`))]
  const max = all.reduce((m, n) => Math.max(m, Number(n.split('-')[2]) || 0), 0)
  return `LIC-${year}-${String(max + 1).padStart(4, '0')}`
}

const str = (v: unknown) => String(v ?? '').trim()

export async function issueLicence(ctx: Ctx, input: any) {
  const { key } = loadKey()
  if (!key) fail("Émission impossible : la clé privée de l'éditeur n'est pas disponible sur ce poste.")
  const company = str(input?.company)
  if (company.length < 2) fail('Raison sociale du client obligatoire, exactement comme elle est configurée chez lui.')
  const tier = str(input?.tier) as Tier
  if (!['essentiel', 'pro', 'entreprise', 'sur-mesure'].includes(tier)) fail('Palier inconnu.')
  let modules: Module[]
  if (tier === 'sur-mesure') {
    const valid = Object.keys(MODULE_NAMES).filter((m) => m !== 'licensing')
    modules = [...new Set((Array.isArray(input?.modules) ? input.modules : []).filter((m: string) => valid.includes(m)))] as Module[]
    if (!modules.length) fail('Choisissez au moins un module pour une licence sur mesure.')
  } else modules = TIERS[tier].modules
  const users = input?.users === '' || input?.users === undefined || input?.users === null ? (tier === 'sur-mesure' ? 3 : TIERS[tier].users) : Number(input.users)
  if (!Number.isInteger(users) || users < 0 || users > 10000) fail("Nombre d'utilisateurs invalide (0 = illimité).")
  const expires = input?.expires ? str(input.expires) : null
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) fail("Date de fin invalide.")
  const today = todayISO()
  if (expires && expires <= today) fail("La date de fin doit être dans le futur.")
  const taxId = str(input?.tax_id)
  const whiteLabel = !!input?.white_label || (tier !== 'sur-mesure' && TIERS[tier].whiteLabel)

  return ctx.db.tx(async (db) => {
    const number = await nextNumber({ ...ctx, db }, today.slice(0, 4))
    const payload: LicencePayload = { v: 1, id: number, company, ...(taxId ? { taxId } : {}), tier, modules, users, issued: today, expires, whiteLabel }
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const licence = `${data}.${sign(null, Buffer.from(data), key).toString('base64url')}`
    const row = await db.one(
      `INSERT INTO licences_issued (number, company, tax_id, tier, modules, users, issued, expires, white_label, licence_key, contact, notes, renews_id, issued_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [number, company, taxId || null, tier, JSON.stringify(modules), users, today, expires, whiteLabel, licence, str(input?.contact) || null, str(input?.notes) || null, Number(input?.renews_id) || null, ctx.user?.id ?? null]
    )
    // Registre CSV partagé avec l'outil en ligne de commande
    const reg = registryPath()
    if (reg) {
      try {
        if (!existsSync(reg)) writeFileSync(reg, CSV_HEADER)
        appendFileSync(reg, [number, today, `"${company.replace(/"/g, '""')}"`, taxId, tier, users || 'illimité', expires ?? 'perpétuelle', whiteLabel ? 'oui' : 'non', licence].join(';') + '\r\n')
      } catch {
        // le registre de la base fait foi
      }
    }
    await audit(db, ctx, 'émission', 'licence', row!.id, `${number} ${company} ${tier}`)
    return row
  })
}

export async function revokeIssued(ctx: Ctx, input: { id: number; reason?: string }) {
  const row = await ctx.db.one<{ number: string; revoked: boolean }>('SELECT number, revoked FROM licences_issued WHERE id = $1', [input?.id])
  if (!row) fail('Licence introuvable.')
  await ctx.db.query('UPDATE licences_issued SET revoked = NOT revoked, revoked_reason = $2 WHERE id = $1', [input.id, row.revoked ? null : str(input.reason) || null])
  await audit(ctx.db, ctx, row.revoked ? 'rétablissement' : 'révocation', 'licence', input.id, row.number)
  return { revoked: !row.revoked }
}

/** Reprend dans la base les licences émises avec l'outil en ligne de commande. */
export async function importRegistry(ctx: Ctx) {
  const reg = registryPath()
  if (!reg || !existsSync(reg)) fail('Aucun registre CSV à importer.')
  const lines = readFileSync(reg, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1).filter(Boolean)
  let added = 0
  for (const line of lines) {
    const [number, date, company, taxId, tier, users, expires, white, licence] = parseCsvLine(line)
    if (!number || !licence) continue
    let payload: LicencePayload | null = null
    try {
      payload = JSON.parse(Buffer.from(licence.split('.')[0], 'base64url').toString('utf8'))
    } catch {
      payload = null
    }
    const r = await ctx.db.query(
      `INSERT INTO licences_issued (number, company, tax_id, tier, modules, users, issued, expires, white_label, licence_key, notes, issued_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Reprise du registre CSV',$11) ON CONFLICT (number) DO NOTHING RETURNING id`,
      [number, company, taxId || null, tier, JSON.stringify(payload?.modules ?? []), users === 'illimité' ? 0 : Number(users) || 0, date, /^\d{4}-\d{2}-\d{2}$/.test(expires) ? expires : null, white === 'oui', licence, ctx.user?.id ?? null]
    )
    added += r.length
  }
  await audit(ctx.db, ctx, 'import', 'licence', null, `${added} licence(s) du registre CSV`)
  return { added, total: lines.length }
}

// ── Bases clients hébergées (serveur multi-clients de l'éditeur) ──────────────────────
// Adresse du serveur et jeton d'administration : table secrets de la base de l'éditeur,
// jamais renvoyés à l'interface. Les appels passent par ce processus, pas par le navigateur.

async function secret(ctx: Ctx, key: string): Promise<string> {
  return (await ctx.db.one<{ value: string }>('SELECT value FROM secrets WHERE key = $1', [key]))?.value ?? ''
}
async function setSecret(ctx: Ctx, key: string, value: string) {
  await ctx.db.query('INSERT INTO secrets (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value])
}

function cloudUrl(raw: string): string {
  let url = str(raw)
  if (!url) fail("Saisissez l'adresse du serveur (ex. cloud.iam.bf).")
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  let u: URL
  try {
    u = new URL(url)
  } catch {
    fail('Adresse du serveur invalide.')
  }
  return `${u.protocol}//${u.host}`
}

async function admin<T = any>(ctx: Ctx, method: string, path: string, body?: unknown, cfg?: { url: string; token: string }): Promise<T> {
  const url = cfg?.url ?? (await secret(ctx, 'cloud_url'))
  const token = cfg?.token ?? (await secret(ctx, 'cloud_admin_token'))
  if (!url || !token) fail("Renseignez d'abord l'adresse du serveur et le jeton d'administration (onglet « Bases clients »).")
  let res: Response
  try {
    res = await fetch(url + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000)
    })
  } catch (e: any) {
    fail(`Serveur ${url} injoignable (${e?.name === 'TimeoutError' ? 'délai dépassé' : e?.cause?.code ?? e?.message ?? e}). Vérifiez l'adresse et la connexion Internet.`)
  }
  let json: any = null
  try {
    json = await res.json()
  } catch {
    fail(`Réponse inattendue du serveur (HTTP ${res.status}) : est-ce bien un serveur IAM INVOICER à jour ?`)
  }
  if (!json?.ok) fail(json?.error ?? `Erreur du serveur (HTTP ${res.status}).`)
  return json.data as T
}

export async function cloudConfig(ctx: Ctx) {
  const [url, token] = await Promise.all([secret(ctx, 'cloud_url'), secret(ctx, 'cloud_admin_token')])
  return { url, hasToken: !!token }
}

export async function cloudSaveConfig(ctx: Ctx, input: { url: string; token?: string }) {
  const url = cloudUrl(input?.url)
  const token = str(input?.token) || (await secret(ctx, 'cloud_admin_token'))
  if (token.length < 32) fail("Jeton d'administration trop court : copiez la valeur ADMIN_TOKEN du serveur (64 caractères).")
  const list = await admin<unknown[]>(ctx, 'GET', '/api/admin/tenants', undefined, { url, token })
  await setSecret(ctx, 'cloud_url', url)
  await setSecret(ctx, 'cloud_admin_token', token)
  await audit(ctx.db, ctx, 'modification', 'cloud', null, url)
  return { url, hasToken: true, tenants: list.length }
}

export async function cloudList(ctx: Ctx) {
  return admin<any[]>(ctx, 'GET', '/api/admin/tenants')
}

export async function cloudInfo(ctx: Ctx, input: { slug: string }) {
  return admin(ctx, 'GET', `/api/admin/tenants/${encodeURIComponent(str(input?.slug))}`)
}

/** Nouvelle base client, avec la licence du registre préinstallée si elle est choisie. */
export async function cloudCreate(ctx: Ctx, input: { name: string; slug?: string; contact?: string; notes?: string; licence_id?: number }) {
  let licence: { licence_key: string; number: string } | undefined
  if (input?.licence_id) {
    licence = await ctx.db.one<{ licence_key: string; number: string }>('SELECT licence_key, number FROM licences_issued WHERE id = $1', [input.licence_id])
    if (!licence) fail('Licence introuvable dans le registre.')
  }
  const created = await admin(ctx, 'POST', '/api/admin/tenants', {
    name: str(input?.name), slug: str(input?.slug) || undefined, contact: str(input?.contact) || undefined, notes: str(input?.notes) || undefined,
    licence_key: licence?.licence_key, licence_number: licence?.number
  })
  await audit(ctx.db, ctx, 'création', 'cloud', null, `${created.slug} ${created.name}`)
  return { ...created, url: (await secret(ctx, 'cloud_url')) + created.path }
}

export async function cloudAction(ctx: Ctx, input: { slug: string; action: 'suspend' | 'resume' | 'password' | 'setup-code' | 'delete'; confirm?: string }) {
  const slug = encodeURIComponent(str(input?.slug))
  const action = input?.action
  let out: unknown
  if (action === 'delete') out = await admin(ctx, 'DELETE', `/api/admin/tenants/${slug}?confirm=${encodeURIComponent(str(input?.confirm))}`)
  else if (['suspend', 'resume', 'password', 'setup-code'].includes(action)) out = await admin(ctx, 'POST', `/api/admin/tenants/${slug}/${action}`, {})
  else fail('Action inconnue.')
  await audit(ctx.db, ctx, action, 'cloud', null, input.slug)
  return out ?? true
}
