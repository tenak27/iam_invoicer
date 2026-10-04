// Serveur hébergeant plusieurs clients : répartit les requêtes entre
//   /t/<client>/…     application, API et liens publics du client (sa propre base)
//   /api/admin/…      administration des clients (jeton ADMIN_TOKEN, éditeur uniquement)
//   le reste          site de présentation et base principale (serveur mono-société habituel)
//
// API d'administration (Authorization: Bearer <ADMIN_TOKEN>) :
//   GET    /api/admin/tenants                       liste (taille de chaque base)
//   POST   /api/admin/tenants                       { name, slug?, contact?, licence_key?, licence_number?, notes? }
//   GET    /api/admin/tenants/:client               fiche et activité
//   POST   /api/admin/tenants/:client/suspend       suspendre (l'accès est refusé, les données restent)
//   POST   /api/admin/tenants/:client/resume        réactiver
//   POST   /api/admin/tenants/:client/password      nouveau mot de passe de la base
//   POST   /api/admin/tenants/:client/setup-code    nouveau code d'activation
//   PATCH  /api/admin/tenants/:client               { name?, contact?, licence_number?, notes? }
//   DELETE /api/admin/tenants/:client?confirm=<client>   suppression définitive

import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHandler, type ServerOptions } from './app'
import { SLUG, type TenantManager, type TenantRow } from './tenants'

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<unknown>

export interface CloudOptions {
  /** Serveur principal (site, base principale) : tout ce qui n'est ni /t/ ni /api/admin/. */
  root: Handler
  manager: TenantManager
  /** Jeton d'administration ; absent ou trop court : API d'administration désactivée. */
  adminToken?: string
  /** Réglages communs aux clients (version, application web, CORS). */
  shared: Omit<ServerOptions, 'db' | 'siteRoot' | 'downloadsDir' | 'publicPath' | 'setupCode'>
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > 256 * 1024) throw Object.assign(new Error('Requête trop volumineuse.'), { status: 413 })
    chunks.push(c as Buffer)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('JSON invalide.'), { status: 400 })
  }
}

export function createCloudHandler(opts: CloudOptions): Handler {
  const { manager } = opts
  const handlers = new Map<string, { handler: Handler; password: string }>()
  const adminKey = opts.adminToken && opts.adminToken.length >= 32 ? Buffer.from(opts.adminToken) : null
  const failures = new Map<string, { n: number; since: number }>()

  const ipOf = (req: IncomingMessage) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || ''

  function isAdmin(req: IncomingMessage): boolean {
    if (!adminKey) return false
    const ip = ipOf(req)
    const f = failures.get(ip)
    if (f && Date.now() - f.since > 15 * 60_000) failures.delete(ip)
    else if (f && f.n >= 10) throw Object.assign(new Error('Trop de tentatives. Réessayez dans 15 minutes.'), { status: 429 })
    const got = Buffer.from(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '')
    const ok = got.length === adminKey.length && timingSafeEqual(got, adminKey)
    if (!ok) {
      const g = failures.get(ip) ?? { n: 0, since: Date.now() }
      g.n++
      failures.set(ip, g)
    }
    return ok
  }

  async function admin(req: IncomingMessage, res: ServerResponse, path: string, url: URL) {
    if (!adminKey) return json(res, 404, { ok: false, error: "Administration désactivée : définissez ADMIN_TOKEN (32 caractères au moins) sur le serveur." })
    if (!isAdmin(req)) return json(res, 401, { ok: false, error: "Jeton d'administration invalide." })
    const m = /^\/api\/admin\/tenants(?:\/([a-z][a-z0-9_]{2,30}))?(?:\/([a-z-]+))?$/.exec(path)
    if (!m) return json(res, 404, { ok: false, error: 'Ressource inconnue.' })
    const [, slug, action] = m
    const method = req.method ?? 'GET'
    const done = (data: unknown) => json(res, 200, { ok: true, data })
    if (!slug) {
      if (method === 'GET') return done(await manager.list())
      if (method === 'POST') return done(await manager.create(await readJson(req)))
    } else if (!action) {
      if (method === 'GET') {
        const t = await manager.get(slug)
        if (!t) return json(res, 404, { ok: false, error: `Client inconnu : ${slug}` })
        const { db_password: _p, ...info } = t
        return done({ ...info, ...(await manager.stats(slug).catch((e) => ({ error: String(e?.message ?? e) }))) })
      }
      if (method === 'PATCH') return done(await manager.update(slug, await readJson(req)))
      if (method === 'DELETE') {
        if (url.searchParams.get('confirm') !== slug) return json(res, 400, { ok: false, error: `Confirmez la suppression avec ?confirm=${slug}.` })
        handlers.delete(slug)
        return done(await manager.remove(slug))
      }
    } else if (method === 'POST') {
      if (action === 'suspend') return done(await manager.setStatus(slug, 'suspended'))
      if (action === 'resume') return done(await manager.setStatus(slug, 'active'))
      if (action === 'password') {
        handlers.delete(slug)
        return done(await manager.resetPassword(slug))
      }
      if (action === 'setup-code') return done(await manager.resetSetupCode(slug))
    }
    return json(res, 405, { ok: false, error: 'Méthode non autorisée.' })
  }

  function tenantHandler(t: TenantRow): Handler {
    const hit = handlers.get(t.slug)
    if (hit && hit.password === t.db_password) return hit.handler
    let inner: Handler | null = null
    const handler: Handler = async (req, res) => {
      if (!inner) {
        const db = await manager.db(t)
        inner = createHandler({
          ...opts.shared,
          db,
          publicPath: `/t/${t.slug}`,
          // Lu à chaque configuration : un nouveau code remplace l'ancien sans redémarrage
          setupCode: async () => (await manager.get(t.slug))?.setup_code ?? null
        })
      }
      return inner!(req, res)
    }
    handlers.set(t.slug, { handler, password: t.db_password })
    return handler
  }

  return async function cloud(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    try {
      if (path.startsWith('/api/admin/')) return await admin(req, res, path, url)
      const m = /^\/t\/([^/]+)(\/.*)?$/.exec(path)
      if (!m) return await opts.root(req, res)
      const slug = m[1]
      const t = SLUG.test(slug) ? await manager.get(slug) : null
      const rest = m[2] ?? ''
      const api = rest.startsWith('/api/')
      if (!t) {
        if (api) return json(res, 404, { ok: false, error: `Aucune base « ${slug} » sur ce serveur. Vérifiez l'adresse fournie.` })
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        return void res.end('Adresse inconnue.')
      }
      if (t.status !== 'active') {
        const msg = 'Accès suspendu. Contactez IAM Technology.'
        if (api) return json(res, 403, { ok: false, error: msg })
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
        return void res.end(msg)
      }
      // /t/client → /t/client/ (l'application web utilise des chemins relatifs)
      if (!rest) {
        res.writeHead(301, { Location: `/t/${slug}/${url.search}` })
        return void res.end()
      }
      req.url = rest + url.search
      return await tenantHandler(t)(req, res)
    } catch (e: any) {
      if (res.headersSent) return void res.end()
      const status = Number(e?.status) || (/inconnu|invalide|obligatoire|déjà utilisé|Confirmez/.test(String(e?.message)) ? 400 : 500)
      if (status === 500) console.error(`[cloud ${req.method} ${path}]`, e)
      return json(res, status, { ok: false, error: status === 500 ? `Erreur du serveur : ${e?.message ?? e}` : String(e?.message ?? e) })
    }
  }
}
