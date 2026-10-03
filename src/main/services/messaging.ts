// Communications : e-mails (SMTP) et SMS (Orange, Twilio ou passerelle HTTP),
// modèles de messages à variables, journal des envois, relances de paiement.

import nodemailer from 'nodemailer'
import { DOC_TYPES, type DocType } from '@shared/domain'
import { formatDate, formatMoney, todayISO } from '@shared/format'
import type { Db } from '../db'
import { audit, fail, str, type Ctx } from './context'
import { loadDocument } from './documents'
import { getSecret, getSettings, type CompanySettings } from './settings'

// ---------- Points d'injection (tests) ----------

type MailTransportFactory = (opts: any) => { sendMail(msg: any): Promise<any> }
let mailTransport: MailTransportFactory = (opts) => nodemailer.createTransport(opts)
let httpFetch: typeof fetch = (...a) => fetch(...a)

export function setMailTransportFactory(f: MailTransportFactory) {
  mailTransport = f
}
export function setHttpFetch(f: typeof fetch) {
  httpFetch = f
}

// ---------- Modèles ----------

export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))
}

export async function documentVars(db: Db, docId: number, userName = '', link = '') {
  const doc = await loadDocument(db, docId)
  const company = await getSettings(db)
  const info = DOC_TYPES[doc.type as DocType]
  const remaining = Math.max(doc.total_ttc - (doc.paid ?? 0), 0)
  const vars: Record<string, string> = {
    type: info.label,
    type_min: info.label.toLowerCase(),
    numero: doc.number ?? 'brouillon',
    date: formatDate(doc.date),
    echeance: formatDate(doc.due_date) || '—',
    montant: formatMoney(doc.total_ttc, company.currency),
    reste: formatMoney(remaining, company.currency),
    client: doc.party?.contact || doc.party?.name || '',
    tiers: doc.party?.name ?? '',
    societe: company.name,
    telephone: company.phone,
    utilisateur: userName,
    lien: link
  }
  return { doc, company, vars }
}

export async function listTemplates(ctx: Ctx) {
  return ctx.db.query('SELECT * FROM message_templates ORDER BY channel, id')
}

export async function saveTemplate(ctx: Ctx, input: { id: number; subject?: string; body: string; name?: string }) {
  const body = str(input.body)
  if (!body) fail('Le message ne peut pas être vide.')
  const row = await ctx.db.one('SELECT channel FROM message_templates WHERE id = $1', [input.id])
  if (!row) fail('Modèle introuvable.')
  if (row.channel === 'sms' && body.length > 480) fail('Un SMS est limité à 480 caractères (3 SMS).')
  await ctx.db.query('UPDATE message_templates SET subject = $1, body = $2, name = COALESCE(NULLIF($3, \'\'), name), updated_at = now() WHERE id = $4', [
    str(input.subject), body, str(input.name), input.id
  ])
  await audit(ctx.db, ctx, 'modification', 'modele_message', input.id)
  return true
}

/** Message pré-rempli pour un document (aperçu avant envoi). */
export async function preview(ctx: Ctx, args: { code: string; documentId: number; link?: string }) {
  const tpl = await ctx.db.one('SELECT * FROM message_templates WHERE code = $1', [args.code])
  if (!tpl) fail('Modèle introuvable.')
  const { doc, vars } = await documentVars(ctx.db, args.documentId, ctx.user?.full_name ?? '', str(args.link))
  return {
    channel: tpl.channel,
    to: tpl.channel === 'email' ? doc.party?.email ?? '' : doc.party?.phone ?? '',
    subject: renderTemplate(tpl.subject, vars),
    body: renderTemplate(tpl.body, vars)
  }
}

// ---------- Journal ----------

async function log(db: Db, ctx: Ctx, e: { channel: 'email' | 'sms'; to: string; subject?: string; body: string; ok: boolean; error?: string; documentId?: number | null; partyId?: number | null; kind: string }) {
  await db.query(
    `INSERT INTO message_log (channel, recipient, subject, body, status, error, document_id, party_id, kind, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [e.channel, e.to, e.subject ?? '', e.body, e.ok ? 'envoye' : 'echec', e.error ?? '', e.documentId ?? null, e.partyId ?? null, e.kind, ctx.user?.id ?? null]
  )
}

export async function listLog(ctx: Ctx, args: { channel?: string; search?: string; documentId?: number } = {}) {
  const search = `%${str(args.search).toLowerCase()}%`
  return ctx.db.query(
    `SELECT m.*, d.number AS document_number, p.name AS party_name, u.full_name AS user_name
     FROM message_log m LEFT JOIN documents d ON d.id = m.document_id LEFT JOIN parties p ON p.id = m.party_id
     LEFT JOIN users u ON u.id = m.user_id
     WHERE ($1 = '' OR m.channel = $1) AND ($2::int IS NULL OR m.document_id = $2)
       AND (lower(m.recipient) LIKE $3 OR lower(m.subject) LIKE $3 OR lower(COALESCE(p.name, '')) LIKE $3)
     ORDER BY m.id DESC LIMIT 500`,
    [str(args.channel), args.documentId ?? null, search]
  )
}

// ---------- E-mail ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function emailHtml(body: string, company: CompanySettings): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  const color = company.doc_color || '#1d6fd6'
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#2f2b3d;line-height:1.55;max-width:620px">
  <div style="height:5px;background:${color};border-radius:3px;margin-bottom:18px"></div>
  ${esc(body).replace(/(https?:\/\/[^\s]+)/g, `<a href="$1" style="color:${color}">$1</a>`).replace(/\n/g, '<br>')}
  <p style="margin-top:22px;font-size:12px;color:#6d6b77">${esc(company.name)}${company.address ? ' · ' + esc(company.address) : ''}${company.city ? ', ' + esc(company.city) : ''}</p>
</div>`
}

async function transportFor(db: Db) {
  const s = await getSettings(db)
  if (!s.smtp_host) fail("Messagerie non configurée : renseignez le serveur SMTP dans « Société & paramètres ».")
  const from = s.smtp_from_email || s.smtp_user
  if (!EMAIL_RE.test(from)) fail("Adresse d'expédition invalide dans les paramètres de messagerie.")
  const transport = mailTransport({
    host: s.smtp_host,
    port: Number(s.smtp_port) || 587,
    secure: !!s.smtp_secure,
    auth: s.smtp_user ? { user: s.smtp_user, pass: await getSecret(db, 'smtp_password') } : undefined,
    connectionTimeout: 15_000
  })
  return { transport, from: s.smtp_from_name ? `"${s.smtp_from_name.replace(/"/g, '')}" <${from}>` : from, settings: s }
}

export interface Attachment {
  filename: string
  content: string // base64
  contentType: string
}

export async function sendEmail(
  ctx: Ctx,
  input: { to: string; subject: string; body: string; documentId?: number | null; kind?: string; attachments?: Attachment[] }
) {
  const to = str(input.to)
  const recipients = to.split(/[,;]\s*/).filter(Boolean)
  if (recipients.length === 0 || !recipients.every((r) => EMAIL_RE.test(r))) fail('Adresse e-mail du destinataire invalide.')
  const subject = str(input.subject)
  if (!subject) fail("L'objet est obligatoire.")
  const body = str(input.body)
  const { transport, from, settings } = await transportFor(ctx.db)
  const partyId = input.documentId
    ? (await ctx.db.one<{ party_id: number }>('SELECT party_id FROM documents WHERE id = $1', [input.documentId]))?.party_id
    : null
  try {
    await transport.sendMail({
      from,
      to: recipients.join(', '),
      subject,
      text: body,
      html: emailHtml(body, settings),
      attachments: (input.attachments ?? []).map((a) => ({ filename: a.filename, content: Buffer.from(a.content, 'base64'), contentType: a.contentType }))
    })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await log(ctx.db, ctx, { channel: 'email', to: recipients.join(', '), subject, body, ok: false, error, documentId: input.documentId, partyId, kind: input.kind ?? 'manuel' })
    fail(`Échec de l'envoi de l'e-mail : ${error}`)
  }
  await log(ctx.db, ctx, { channel: 'email', to: recipients.join(', '), subject, body, ok: true, documentId: input.documentId, partyId, kind: input.kind ?? 'manuel' })
  return true
}

// ---------- SMS ----------

/** Numéro au format international ; 8 chiffres = numéro burkinabè (+226). */
export function normalizePhone(raw: string): string {
  let n = String(raw ?? '').replace(/[\s.\-()]/g, '')
  if (n.startsWith('00')) n = '+' + n.slice(2)
  if (/^\d{8}$/.test(n)) n = '+226' + n
  if (/^226\d{8}$/.test(n)) n = '+' + n
  if (!/^\+\d{8,15}$/.test(n)) fail(`Numéro de téléphone invalide : ${raw}`)
  return n
}

async function smsSend(db: Db, to: string, message: string): Promise<void> {
  const s = await getSettings(db)
  const secret = await getSecret(db, 'sms_secret')
  if (!s.sms_provider) fail("SMS non configurés : choisissez un fournisseur dans « Société & paramètres ».")
  const check = async (res: Response, what: string) => {
    if (!res.ok) fail(`${what} a refusé l'envoi (HTTP ${res.status}) : ${(await res.text().catch(() => '')).slice(0, 200)}`)
  }
  if (s.sms_provider === 'http') {
    // Passerelle générique : URL avec {to}, {message}, {sender}, {key}.
    if (!s.sms_http_url) fail("Renseignez l'URL de la passerelle SMS.")
    const url = s.sms_http_url
      .replace('{to}', encodeURIComponent(to))
      .replace('{message}', encodeURIComponent(message))
      .replace('{sender}', encodeURIComponent(s.sms_sender))
      .replace('{key}', encodeURIComponent(secret))
    await check(await httpFetch(url, { signal: AbortSignal.timeout(20_000) }), 'La passerelle SMS')
    return
  }
  if (s.sms_provider === 'twilio') {
    if (!s.sms_account || !secret || !s.sms_sender) fail('Twilio : identifiant de compte, jeton et numéro expéditeur requis.')
    const res = await httpFetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(s.sms_account)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${s.sms_account}:${secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: to, From: s.sms_sender, Body: message }),
      signal: AbortSignal.timeout(20_000)
    })
    await check(res, 'Twilio')
    return
  }
  if (s.sms_provider === 'orange') {
    // API SMS d'Orange (developer.orange.com) : jeton OAuth puis envoi.
    if (!s.sms_account || !secret || !s.sms_sender) fail('Orange : client ID, client secret et numéro expéditeur (tel:+226…) requis.')
    const tok = await httpFetch('https://api.orange.com/oauth/v3/token', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${s.sms_account}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(20_000)
    })
    await check(tok, 'Orange (authentification)')
    const { access_token } = (await tok.json()) as { access_token: string }
    const sender = s.sms_sender.startsWith('tel:') ? s.sms_sender : `tel:${normalizePhone(s.sms_sender)}`
    const res = await httpFetch(`https://api.orange.com/smsmessaging/v1/outbound/${encodeURIComponent(sender)}/requests`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ outboundSMSMessageRequest: { address: `tel:${to}`, senderAddress: sender, outboundSMSTextMessage: { message } } }),
      signal: AbortSignal.timeout(20_000)
    })
    await check(res, 'Orange')
    return
  }
  fail('Fournisseur SMS inconnu.')
}

export async function sendSms(ctx: Ctx, input: { to: string; body: string; documentId?: number | null; kind?: string }) {
  const body = str(input.body)
  if (!body) fail('Le message est vide.')
  if (body.length > 480) fail('Message trop long (480 caractères maximum).')
  const to = normalizePhone(input.to)
  const partyId = input.documentId
    ? (await ctx.db.one<{ party_id: number }>('SELECT party_id FROM documents WHERE id = $1', [input.documentId]))?.party_id
    : null
  try {
    await smsSend(ctx.db, to, body)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await log(ctx.db, ctx, { channel: 'sms', to, body, ok: false, error, documentId: input.documentId, partyId, kind: input.kind ?? 'manuel' })
    throw e
  }
  await log(ctx.db, ctx, { channel: 'sms', to, body, ok: true, documentId: input.documentId, partyId, kind: input.kind ?? 'manuel' })
  return true
}

/** Message d'essai à l'administrateur, pour valider la configuration. */
export async function sendTest(ctx: Ctx, input: { channel: 'email' | 'sms'; to: string }) {
  const s = await getSettings(ctx.db)
  const body = `Message d'essai envoyé par IAM INVOICER pour ${s.name}. La configuration fonctionne.`
  if (input.channel === 'email') return sendEmail(ctx, { to: input.to, subject: 'Essai de messagerie IAM INVOICER', body, kind: 'essai' })
  return sendSms(ctx, { to: input.to, body, kind: 'essai' })
}

// ---------- Relances ----------

/** Relance une facture en retard par e-mail ou SMS, avec le modèle de relance. */
export async function remind(ctx: Ctx, input: { documentId: number; channel: 'email' | 'sms'; attachments?: Attachment[] }) {
  const doc = await ctx.db.one('SELECT type, status FROM documents WHERE id = $1', [input.documentId])
  if (!doc || doc.type !== 'FAC' || doc.status !== 'valide') fail('Seule une facture validée peut être relancée.')
  const p = await preview(ctx, { code: input.channel === 'email' ? 'reminder_email' : 'reminder_sms', documentId: input.documentId })
  if (!p.to) fail(input.channel === 'email' ? "Le client n'a pas d'adresse e-mail." : "Le client n'a pas de numéro de téléphone.")
  if (input.channel === 'email') await sendEmail(ctx, { to: p.to, subject: p.subject, body: p.body, documentId: input.documentId, kind: 'relance', attachments: input.attachments })
  else await sendSms(ctx, { to: p.to, body: p.body, documentId: input.documentId, kind: 'relance' })
  return true
}

/** Relance toutes les factures échues non soldées ; renvoie le bilan. */
export async function remindAll(ctx: Ctx, input: { channel: 'email' | 'sms' }) {
  const overdue = await ctx.db.query<{ id: number; number: string }>(
    `SELECT d.id, d.number FROM documents d
     WHERE d.type = 'FAC' AND d.status = 'valide' AND d.due_date < $1
       AND d.total_ttc > COALESCE((SELECT SUM(amount) FROM payments WHERE document_id = d.id), 0) + 0.5
     ORDER BY d.due_date`,
    [todayISO()]
  )
  const result = { sent: 0, failed: [] as { number: string; error: string }[] }
  for (const d of overdue) {
    try {
      await remind(ctx, { documentId: d.id, channel: input.channel })
      result.sent++
    } catch (e) {
      result.failed.push({ number: d.number, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}

/**
 * Envoi d'un document par e-mail. Le poste de bureau fournit le PDF (rendu par
 * Electron) ; depuis le web et le mobile, le serveur joint la version HTML.
 */
export async function sendDocument(ctx: Ctx, input: { documentId: number; to: string; subject: string; body: string; pdf?: string }) {
  const { documentHtml } = await import('../pdf')
  const { signaturesForPrint } = await import('./signatures')
  const doc = await loadDocument(ctx.db, input.documentId)
  const base = `${doc.number ?? 'Brouillon-' + doc.type + '-' + doc.id} - ${doc.party.name}`.replace(/[\/:*?"<>|]/g, '-')
  let attachment: Attachment
  if (input.pdf) {
    attachment = { filename: base + '.pdf', content: input.pdf, contentType: 'application/pdf' }
  } else {
    doc.signatures = await signaturesForPrint(ctx.db, doc.id)
    const html = documentHtml(doc, await getSettings(ctx.db), false)
    attachment = { filename: base + '.html', content: Buffer.from(html).toString('base64'), contentType: 'text/html' }
  }
  return sendEmail(ctx, { to: input.to, subject: input.subject, body: input.body, documentId: input.documentId, kind: 'document', attachments: [attachment] })
}
