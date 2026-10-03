// Serveur web IAM INVOICER : héberge l'API et l'application web sur un domaine
// (ex. https://facturation.iam.bf). Les postes Windows/macOS, les applications
// iOS/Android et les navigateurs s'y connectent et partagent les mêmes données.
//
// API (JSON) :
//   GET  /api/status                 version, configuration initiale requise, utilisateur courant
//   POST /api/login                  { username, password, device } → { token, user }
//   POST /api/setup                  première configuration → { token, user }
//   POST /api/logout
//   POST /api/call                   { name, args } → appel du routeur métier
//   GET  /api/document/:id?format=   HTML imprimable (export PDF des postes de bureau)
//   POST /api/print                  { id, format } → { url } lien d'impression à usage unique
//   GET  /print/:ticket              page imprimable (navigateur, mobile)
//   GET  /api/downloads              installateurs disponibles (site de présentation)
//   GET  /api/ios-manifest/:fichier  manifeste d'installation iPhone d'un .ipa signé
// Authentification : en-tête « Authorization: Bearer <jeton> ».

import { randomBytes } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { Db } from '../main/db'
import { printable, type PrintFormat } from '../main/printing'
import { call } from '../main/router'
import { login, needsSetup, setup } from '../main/services/auth'
import { AppError, type Ctx, type SessionUser } from '../main/services/context'
import { createToken, resolveToken, revokeToken } from '../main/services/tokens'
import { publicRequest, signRemote } from '../main/services/signatures'
import { documentHtml } from '../main/pdf'
import { DOC_TYPES, type DocType } from '@shared/domain'
import { formatMoney } from '@shared/format'
import { signPageHtml } from './signPage'
import { iosManifest, listDownloads } from './downloads'

export interface ServerOptions {
  db: Db
  version: string
  /** Dossier de l'application web compilée (servie sous /app/, ou à la racine sans site). */
  webRoot?: string
  /** Site de présentation (racine du domaine). Absent : l'application est servie à la racine. */
  siteRoot?: string
  /** Fichiers d'installation proposés au téléchargement (/telechargements/). */
  downloadsDir?: string
  /** Origines autorisées pour CORS ; « * » par défaut (jetons, pas de cookies). */
  corsOrigin?: string
}

const MAX_BODY = 4 * 1024 * 1024
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  // Installateurs : le bon type permet à Android et macOS de proposer l'installation
  '.apk': 'application/vnd.android.package-archive',
  '.ipa': 'application/octet-stream',
  '.dmg': 'application/x-apple-diskimage',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.zip': 'application/zip'
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** Limite les essais de mot de passe : 10 échecs par adresse IP et par quart d'heure. */
class LoginLimiter {
  private failures = new Map<string, { n: number; since: number }>()
  check(ip: string) {
    const f = this.failures.get(ip)
    if (f && Date.now() - f.since > 15 * 60_000) this.failures.delete(ip)
    else if (f && f.n >= 10) throw new HttpError(429, 'Trop de tentatives de connexion. Réessayez dans 15 minutes.')
  }
  fail(ip: string) {
    const f = this.failures.get(ip) ?? { n: 0, since: Date.now() }
    f.n++
    this.failures.set(ip, f)
  }
  success(ip: string) {
    this.failures.delete(ip)
  }
}

export function createHandler(opts: ServerOptions) {
  const { db } = opts
  const limiter = new LoginLimiter()
  // Liens d'impression à usage unique, valables 2 minutes.
  const tickets = new Map<string, { user: SessionUser; id: number; format: PrintFormat; expires: number }>()

  async function readJson(req: IncomingMessage): Promise<any> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY) throw new HttpError(413, 'Requête trop volumineuse.')
      chunks.push(chunk as Buffer)
    }
    if (size === 0) return {}
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new HttpError(400, 'JSON invalide.')
    }
  }

  function send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  const bearer = (req: IncomingMessage) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null
  const clientIp = (req: IncomingMessage) =>
    String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || ''

  async function session(req: IncomingMessage): Promise<SessionUser> {
    const user = await resolveToken(db, bearer(req))
    if (!user) throw new HttpError(401, 'Session expirée, veuillez vous reconnecter.')
    return user
  }

  async function api(req: IncomingMessage, res: ServerResponse, path: string, url: URL) {
    const method = req.method ?? 'GET'
    // Fichiers d'installation disponibles (site de présentation)
    if (method === 'GET' && path === '/api/downloads') {
      const files = await listDownloads(opts.downloadsDir)
      return send(res, 200, { ok: true, data: { version: opts.version, files } })
    }
    const manifest = /^\/api\/ios-manifest\/([^/]+)\.plist$/.exec(path)
    if (method === 'GET' && manifest) {
      let name: string
      try {
        name = decodeURIComponent(manifest[1])
      } catch {
        throw new HttpError(400, 'Adresse invalide.')
      }
      const file = (await listDownloads(opts.downloadsDir)).find((f) => f.name === name && f.kind === 'ipa' && f.signed)
      if (!file) throw new HttpError(404, 'Fichier introuvable.')
      const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
      if (!/^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) throw new HttpError(400, 'Hôte invalide.')
      const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim() === 'https' ? 'https' : 'http'
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-cache' })
      return res.end(iosManifest(`${proto}://${host}`, file, opts.version))
    }
    if (method === 'GET' && path === '/api/status') {
      const user = await resolveToken(db, bearer(req))
      return send(res, 200, { ok: true, data: { app: 'IAM INVOICER', version: opts.version, needsSetup: await needsSetup(db), user } })
    }
    if (method === 'POST' && path === '/api/login') {
      const ip = clientIp(req)
      limiter.check(ip)
      const body = await readJson(req)
      let user: SessionUser
      try {
        user = await login(db, body.username, body.password)
      } catch (e) {
        limiter.fail(ip)
        throw e
      }
      limiter.success(ip)
      const token = await createToken(db, user.id, String(body.device ?? req.headers['user-agent'] ?? ''))
      return send(res, 200, { ok: true, data: { token, user } })
    }
    if (method === 'POST' && path === '/api/setup') {
      const body = await readJson(req)
      const user = await setup({ db, user: null }, body)
      const token = await createToken(db, user.id, String(body.device ?? ''))
      return send(res, 200, { ok: true, data: { token, user } })
    }
    if (method === 'POST' && path === '/api/logout') {
      const token = bearer(req)
      if (token) await revokeToken(db, token)
      return send(res, 200, { ok: true, data: true })
    }
    if (method === 'POST' && path === '/api/call') {
      const body = await readJson(req)
      const name = String(body.name ?? '')
      // Les appels publics (configuration initiale) passent sans jeton.
      const user = await resolveToken(db, bearer(req))
      if (!user && name !== 'auth.needsSetup') throw new HttpError(401, 'Session expirée, veuillez vous reconnecter.')
      // Liens de signature : par défaut, l'adresse publique est celle par laquelle on joint ce serveur.
      if (name === 'signatures.request' && body.args && !body.args.baseUrl) body.args.baseUrl = publicOrigin(req)
      // Hors ligne : une opération rejouée à la resynchronisation n'est exécutée qu'une fois.
      const opId = typeof body.opId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.opId) ? body.opId : null
      if (opId && user) {
        const done = await db.one<{ result: string }>('SELECT result FROM client_ops WHERE op_id = $1 AND user_id = $2', [opId, user.id])
        if (done) return send(res, 200, { ...JSON.parse(done.result), replayed: true })
      }
      const result = await call({ db, user }, name, body.args)
      if (opId && user && result.ok) {
        await db.query('INSERT INTO client_ops (op_id, user_id, name, result) VALUES ($1, $2, $3, $4) ON CONFLICT (op_id) DO NOTHING', [opId, user.id, name, JSON.stringify(result)])
      }
      return send(res, 200, result)
    }
    const docMatch = /^\/api\/document\/(\d+)$/.exec(path)
    if (method === 'GET' && docMatch) {
      const ctx: Ctx = { db, user: await session(req) }
      const format = url.searchParams.get('format') === 'ticket' ? 'ticket' : 'a4'
      return send(res, 200, { ok: true, data: await printable(ctx, Number(docMatch[1]), format, url.searchParams.get('pdf') === '1') })
    }
    if (method === 'POST' && path === '/api/print') {
      const user = await session(req)
      const body = await readJson(req)
      const id = Number(body.id)
      const format: PrintFormat = body.format === 'ticket' ? 'ticket' : 'a4'
      await printable({ db, user }, id, format, false) // vérifie les droits avant d'émettre le lien
      const ticket = randomBytes(24).toString('base64url')
      const now = Date.now()
      for (const [k, t] of tickets) if (t.expires < now) tickets.delete(k)
      tickets.set(ticket, { user, id, format, expires: now + 120_000 })
      return send(res, 200, { ok: true, data: { url: `/print/${ticket}` } })
    }
    const signMatch = /^\/api\/public\/sign\/([A-Za-z0-9_-]{20,})$/.exec(path)
    if (method === 'POST' && signMatch) {
      const body = await readJson(req)
      await signRemote(db, signMatch[1], { name: body.name, image: body.image, ip: clientIp(req), device: String(req.headers['user-agent'] ?? '') })
      return send(res, 200, { ok: true, data: true })
    }
    throw new HttpError(404, 'Ressource inconnue.')
  }

  function publicOrigin(req: IncomingMessage): string {
    const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0] || 'http'
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    return `${proto}://${host}`
  }

  async function signPage(res: ServerResponse, token: string) {
    let page: string
    try {
      const { req, doc, company } = await publicRequest(db, token)
      const state = req.status === 'signe' ? 'signed' : req.status !== 'en_attente' || !req.active ? 'expired' : 'ok'
      const info = DOC_TYPES[doc.type as DocType]
      page = signPageHtml({
        company,
        doc: { ...doc, typeLabel: info.label, amount: formatMoney(doc.total_ttc, company.currency) },
        docHtml: documentHtml(doc, company, false),
        state,
        token
      })
    } catch (e) {
      if (!(e instanceof AppError)) throw e
      throw new HttpError(404, e.message)
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' })
    res.end(page)
  }

  async function printPage(res: ServerResponse, ticket: string) {
    const t = tickets.get(ticket)
    tickets.delete(ticket)
    if (!t || t.expires < Date.now()) throw new HttpError(410, "Ce lien d'impression a expiré. Relancez l'impression depuis l'application.")
    const p = await printable({ db, user: t.user }, t.id, t.format, false)
    const auto = '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},300)})</script>'
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(p.html.replace('</body>', `${auto}</body>`))
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, path: string, base = opts.webRoot, spa = true, download = false) {
    if (!base) throw new HttpError(404, 'Application web non installée sur ce serveur.')
    const root = resolve(base)
    let decoded: string
    try {
      decoded = decodeURIComponent(path)
    } catch {
      throw new HttpError(400, 'Adresse invalide.')
    }
    let file = normalize(join(root, decoded))
    // Le fichier doit être DANS le dossier web (et pas dans un dossier voisin au nom proche).
    if (file !== root && !file.startsWith(root + sep)) throw new HttpError(403, 'Accès refusé.')
    if (!existsSync(file) || statSync(file).isDirectory()) {
      if (!spa) throw new HttpError(404, 'Fichier introuvable.')
      file = join(root, 'index.html') // application monopage
    }
    if (!existsSync(file)) throw new HttpError(404, 'Page introuvable.')
    const ext = extname(file)
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      // Les fichiers compilés portent une empreinte dans leur nom : cache long, sauf les pages et les installateurs.
      'Cache-Control': ext === '.html' || download ? 'no-cache' : 'public, max-age=31536000, immutable',
      ...(download ? { 'Content-Disposition': `attachment; filename="${encodeURIComponent(file.split(sep).pop()!)}"`, 'Content-Length': String(statSync(file).size) } : {})
    })
    if (req.method === 'HEAD') return res.end()
    createReadStream(file).pipe(res)
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (path.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', opts.corsOrigin ?? '*')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Max-Age', '86400')
    }
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        return res.end()
      }
      if (path === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        return res.end('ok')
      }
      if (path.startsWith('/api/')) return await api(req, res, path, url)
      if (path.startsWith('/print/')) return await printPage(res, path.slice('/print/'.length))
      if (/^\/sign\/[A-Za-z0-9_-]{20,}$/.test(path)) return await signPage(res, path.slice('/sign/'.length))
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée.')
      // Fichiers d'installation
      if (path.startsWith('/telechargements/')) return serveStatic(req, res, path.slice('/telechargements'.length), opts.downloadsDir, false, true)
      const site = opts.siteRoot && existsSync(join(opts.siteRoot, 'index.html')) ? opts.siteRoot : null
      if (!site) return serveStatic(req, res, path)
      // Site de présentation à la racine, application sous /app/
      if (path === '/app') {
        res.writeHead(301, { Location: '/app/' + url.search })
        return res.end()
      }
      if (path.startsWith('/app/')) return serveStatic(req, res, path.slice('/app'.length))
      return serveStatic(req, res, path, site, true)
    } catch (e) {
      if (res.headersSent) return res.end()
      if (e instanceof HttpError) return send(res, e.status, { ok: false, error: e.message })
      if (e instanceof AppError) return send(res, 200, { ok: false, error: e.message })
      console.error(`[${req.method} ${path}]`, e)
      return send(res, 500, { ok: false, error: 'Erreur interne du serveur.' })
    }
  }
}
