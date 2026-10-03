// Facture électronique certifiée (SECeF, DGI du Burkina Faso).
//
// Deux modes :
//  - « simulation » : codes fictifs clairement marqués, pour tester le circuit ;
//  - « api » : connecteur HTTP modelé sur les API e-MCF (envoi de la facture,
//    puis confirmation qui renvoie le code de certification, le compteur et
//    le QR code). Les noms de champs sont centralisés ci-dessous : ils DOIVENT
//    être ajustés à la spécification officielle remise par la DGI avec vos
//    identifiants (NIM, jeton), avant toute mise en production.
// En mode « api », une facture ou un avoir ne peut pas être validé sans
// certification : en cas d'échec, la validation est annulée.

import { randomBytes } from 'node:crypto'
import QRCode from 'qrcode'
import type { Db } from '../db'
import { fail, type Ctx } from './context'
import { getSecret, getSettings } from './settings'

let httpFetch: typeof fetch = (...a) => fetch(...a)
export function setSecefFetch(f: typeof fetch) {
  httpFetch = f
}

/** Groupes de taxation : A = exonéré, B = TVA au taux normal (18 %). */
export const taxGroup = (rate: number) => (rate > 0 ? 'B' : 'A')

const group4 = (s: string) => s.match(/.{1,4}/g)!.join('-')

export async function certify(db: Db, ctx: Ctx, docId: number): Promise<void> {
  const s = await getSettings(db)
  if (!s.secef_mode) return
  const doc = await db.one(
    `SELECT d.*, p.name AS party_name, p.tax_id AS party_ifu, p.address AS party_address, p.phone AS party_phone
     FROM documents d JOIN parties p ON p.id = d.party_id WHERE d.id = $1`,
    [docId]
  )
  if (!doc || (doc.type !== 'FAC' && doc.type !== 'AV')) return
  const lines = await db.query('SELECT description, quantity, unit_price, discount, tva_rate, total_ht FROM document_lines WHERE document_id = $1 ORDER BY position', [docId])
  const now = new Date()
  const stamp = `${now.toLocaleDateString('fr-FR')} ${now.toLocaleTimeString('fr-FR')}`

  if (s.secef_mode === 'simulation') {
    const count = await db.one<{ n: number }>("SELECT COUNT(*)::int + 1 AS n FROM documents WHERE secef_status = 'certifie'")
    const code = 'SIM-' + group4(randomBytes(12).toString('hex').toUpperCase())
    const nim = `SIM-${s.secef_nim || 'EM01'}`
    const counters = `${count!.n}/${count!.n} ${doc.type === 'FAC' ? 'FV' : 'FA'}`
    const qr = `F;${nim};${code};${s.tax_id || 'IFU'};${now.toISOString()}`
    await db.query(
      "UPDATE documents SET secef_status = 'certifie', secef_code = $1, secef_nim = $2, secef_counters = $3, secef_qr = $4, secef_date = $5, secef_error = '' WHERE id = $6",
      [code, nim, counters, qr, stamp, docId]
    )
    return
  }

  // Mode API
  if (!s.secef_url) fail("Certification SECeF : renseignez l'adresse de l'API dans « Société & paramètres ».")
  const token = await getSecret(db, 'secef_token')
  if (!token) fail('Certification SECeF : jeton d’accès manquant.')
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const payload = {
    ifu: s.tax_id,
    type: doc.type === 'FAC' ? 'FV' : 'FA',
    reference: doc.type === 'AV' ? doc.reference : undefined,
    operator: { name: ctx.user?.full_name ?? '' },
    client: { name: doc.party_name, ifu: doc.party_ifu || undefined, address: doc.party_address || undefined, contact: doc.party_phone || undefined },
    items: lines.map((l) => ({
      name: l.description.slice(0, 200),
      price: Math.round(l.unit_price * (1 + l.tva_rate / 100) * (1 - l.discount / 100)),
      quantity: l.quantity,
      taxGroup: taxGroup(l.tva_rate)
    })),
    payment: [{ name: 'ESPECES', amount: Math.round(doc.total_ttc) }]
  }
  const call = async (method: string, path: string, body?: unknown) => {
    let res: Response
    try {
      res = await httpFetch(s.secef_url.replace(/\/+$/, '') + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) })
    } catch (e) {
      fail(`Certification SECeF impossible : serveur injoignable (${e instanceof Error ? e.message : e}).`)
    }
    const json: any = await res.json().catch(() => ({}))
    if (!res.ok || json.errorCode) fail(`Certification SECeF refusée : ${json.errorDesc ?? json.message ?? 'HTTP ' + res.status}.`)
    return json
  }
  const created = await call('POST', '/invoice', payload)
  if (!created.uid) fail('Certification SECeF : réponse sans identifiant de facture.')
  const confirmed = await call('PUT', `/invoice/${encodeURIComponent(created.uid)}/confirm`)
  await db.query(
    "UPDATE documents SET secef_status = 'certifie', secef_code = $1, secef_nim = $2, secef_counters = $3, secef_qr = $4, secef_date = $5, secef_error = '' WHERE id = $6",
    [confirmed.codeMECeFDGI ?? confirmed.code ?? '', confirmed.nim ?? s.secef_nim, confirmed.counters ?? '', confirmed.qrCode ?? '', confirmed.dateTime ?? stamp, docId]
  )
}

/** QR code en SVG (synchrone, pour le gabarit d'impression). */
export function qrSvg(text: string, size = 110): string {
  if (!text) return ''
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const cell = size / (n + 2)
  let path = ''
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) path += `M${((x + 1) * cell).toFixed(2)} ${((y + 1) * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
}
