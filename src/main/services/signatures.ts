// Signatures électroniques des documents (devis, bons de livraison, factures…).
//
// - Sur place : le client signe sur l'écran (tablette, téléphone, souris).
// - À distance : un lien unique (30 jours) est envoyé par e-mail ou SMS ; le
//   client consulte le document et signe depuis son navigateur.
// Chaque signature conserve l'empreinte SHA-256 du contenu signé, la date,
// l'adresse IP et l'appareil : on peut ainsi prouver ce qui a été accepté.

import { createHash, randomBytes } from 'node:crypto'
import type { Db } from '../db'
import { audit, fail, str, type Ctx } from './context'
import { loadDocument } from './documents'
import { getSettings } from './settings'

const MAX_IMAGE = 400_000

/** Empreinte du contenu engageant : numéro, tiers, date, lignes et totaux. */
export function contentHash(doc: any): string {
  const payload = JSON.stringify({
    number: doc.number,
    type: doc.type,
    date: doc.date,
    party: doc.party_id,
    total_ttc: doc.total_ttc,
    lines: (doc.lines ?? []).map((l: any) => [l.description, l.quantity, l.unit_price, l.discount, l.tva_rate])
  })
  return createHash('sha256').update(payload).digest('hex')
}

function checkImage(image: string) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)) fail('Signature invalide.')
  if (image.length > MAX_IMAGE) fail('Image de signature trop lourde.')
  // Une signature vide (simple clic) fait moins de quelques centaines d'octets.
  if (image.length < 1200) fail('Veuillez signer dans le cadre avant de valider.')
}

async function signable(db: Db, documentId: number) {
  const doc = await loadDocument(db, documentId)
  if (doc.status !== 'valide') fail('Seul un document validé peut être signé.')
  return doc
}

async function record(db: Db, ctx: Ctx | null, doc: any, input: { name: string; image: string; method: 'sur_place' | 'a_distance'; ip?: string; device?: string }) {
  const name = str(input.name)
  if (name.length < 2) fail('Indiquez le nom du signataire.')
  checkImage(input.image)
  const row = await db.one<{ id: number }>(
    `INSERT INTO signatures (document_id, signer_name, image, content_hash, method, ip, device, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [doc.id, name, input.image, contentHash(doc), input.method, str(input.ip).slice(0, 80), str(input.device).slice(0, 200), ctx?.user?.id ?? null]
  )
  await audit(db, ctx ?? { db, user: null }, 'signature', doc.type, doc.id, `${name} (${input.method === 'sur_place' ? 'sur place' : 'à distance'})`)
  return row!
}

export async function listSignatures(ctx: Ctx, args: { documentId: number }) {
  const doc = await loadDocument(ctx.db, args.documentId)
  const rows = await ctx.db.query(
    'SELECT id, signer_name, signer_role, image, content_hash, method, ip, device, signed_at FROM signatures WHERE document_id = $1 ORDER BY id',
    [args.documentId]
  )
  const current = contentHash(doc)
  const pending = await ctx.db.one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM sign_requests WHERE document_id = $1 AND status = 'en_attente' AND expires_at > now()",
    [args.documentId]
  )
  return { signatures: rows.map((r) => ({ ...r, valid: r.content_hash === current })), pendingRequests: pending?.n ?? 0 }
}

export async function signOnSite(ctx: Ctx, input: { documentId: number; name: string; image: string; device?: string }) {
  return ctx.db.tx(async (db) => {
    const doc = await signable(db, input.documentId)
    return record(db, ctx, doc, { ...input, method: 'sur_place', device: input.device ?? 'Signature sur place' })
  })
}

const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex')

/** Crée un lien de signature à distance. baseUrl : adresse publique du serveur. */
export async function createRequest(ctx: Ctx, input: { documentId: number; baseUrl?: string; days?: number }) {
  const doc = await signable(ctx.db, input.documentId)
  const settings = await getSettings(ctx.db)
  const base = str(input.baseUrl) || settings.public_url
  if (!/^https?:\/\//.test(base)) fail("Indiquez l'adresse publique du serveur (ex. https://facturation.iam.bf) dans « Société & paramètres » pour envoyer des liens de signature.")
  const token = randomBytes(24).toString('base64url')
  const days = Math.min(Math.max(Number(input.days) || 30, 1), 90)
  await ctx.db.query(
    `INSERT INTO sign_requests (token_hash, document_id, expires_at, created_by) VALUES ($1, $2, now() + ($3 || ' days')::interval, $4)`,
    [tokenHash(token), doc.id, String(days), ctx.user?.id ?? null]
  )
  await audit(ctx.db, ctx, 'demande_signature', doc.type, doc.id, doc.number)
  return { url: `${base.replace(/\/+$/, '')}/sign/${token}`, expiresInDays: days }
}

/** Accès public (sans compte) : document à signer et état de la demande. */
export async function publicRequest(db: Db, token: string) {
  const req = await db.one(
    `SELECT document_id, status, expires_at > now() AS active FROM sign_requests WHERE token_hash = $1`,
    [tokenHash(token)]
  )
  if (!req) fail('Lien de signature inconnu.')
  const doc = await loadDocument(db, req.document_id)
  return { req, doc, company: await getSettings(db) }
}

export async function signRemote(db: Db, token: string, input: { name: string; image: string; ip?: string; device?: string }) {
  return db.tx(async (t) => {
    const req = await t.one(
      'SELECT document_id, status, expires_at > now() AS active FROM sign_requests WHERE token_hash = $1 FOR UPDATE',
      [tokenHash(token)]
    )
    if (!req) fail('Lien de signature inconnu.')
    if (req.status === 'signe') fail('Ce document a déjà été signé.')
    if (req.status !== 'en_attente' || !req.active) fail('Ce lien a expiré. Demandez un nouveau lien à votre fournisseur.')
    const doc = await signable(t, req.document_id)
    const row = await record(t, null, doc, { ...input, method: 'a_distance' })
    await t.query("UPDATE sign_requests SET status = 'signe' WHERE token_hash = $1", [tokenHash(token)])
    return row
  })
}

/** Signatures à imprimer sur le document (PDF). */
export async function signaturesForPrint(db: Db, documentId: number) {
  return db.query(
    'SELECT signer_name, image, content_hash, method, signed_at FROM signatures WHERE document_id = $1 ORDER BY id',
    [documentId]
  )
}
