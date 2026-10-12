// Serveur hébergeant plusieurs clients : répartit les requêtes entre
//   /t/<client>/…     application, API et liens publics du client (sa propre base)
//   /admin/           console de l'éditeur (sociétés hébergées, licences)
//   /api/admin/…      administration des clients (éditeur uniquement)
//   le reste          site de présentation et base principale (serveur mono-société habituel)
//
// API d'administration. Authentification « Authorization: Bearer … » avec, au choix :
//   - le jeton ADMIN_TOKEN du serveur ;
//   - le jeton de session du compte administrateur de l'éditeur (VENDOR_ADMIN) sur la base
//     principale, obtenu par POST /api/login : c'est ce qu'utilise la console /admin/.
//
//   GET    /api/admin/me                            qui est connecté, émission de licences possible ou non
//   GET    /api/admin/tenants                       liste (taille de chaque base)
//   POST   /api/admin/tenants                       { name, slug?, contact?, notes?, licence_key? | licence_id?, licence_number? }
//   GET    /api/admin/tenants/:client               fiche, activité et état de la licence
//   POST   /api/admin/tenants/:client/suspend       suspendre (l'accès est refusé, les données restent)
//   POST   /api/admin/tenants/:client/resume        réactiver
//   POST   /api/admin/tenants/:client/password      nouveau mot de passe de la base
//   POST   /api/admin/tenants/:client/setup-code    nouveau code d'activation
//   POST   /api/admin/tenants/:client/sync-key      nouvelle clé de synchronisation (copie d'un serveur d'entreprise)
//   POST   /api/admin/tenants/:client/licence       { licence_key | licence_id } attribuer une licence
//   PATCH  /api/admin/tenants/:client               { name?, contact?, licence_number?, notes? }
//   DELETE /api/admin/tenants/:client?confirm=<client>   suppression définitive
//   GET    /api/admin/licences                      registre des licences émises
//   POST   /api/admin/licences                      émettre (clé privée de l'éditeur sur le serveur)
//   POST   /api/admin/licences/:id/revoke           révoquer ou rétablir au registre

import { timingSafeEqual } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import type { Snapshot } from '../main/snapshot'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isVendorAdmin } from '@shared/licence'
import type { Db } from '../main/db'
import { AppError, type SessionUser } from '../main/services/context'
import { issueLicence, listIssued, revokeIssued, vendorKeyAvailable } from '../main/services/licensing'
import { resolveToken } from '../main/services/tokens'
import { adminPageHtml } from './adminPage'
import { createHandler, type ServerOptions } from './app'
import { SLUG, type TenantManager, type TenantRow } from './tenants'

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<unknown>

export interface CloudOptions {
  /** Serveur principal (site, base principale) : tout ce qui n'est ni /t/ ni /api/admin/. */
  root: Handler
  manager: TenantManager
  /** Jeton d'administration ; absent ou trop court : API d'administration désactivée. */
  adminToken?: string
  /** Base principale : comptes de l'éditeur (connexion à la console) et registre des licences. */
  rootDb?: Db
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

/** Instantané envoyé par un serveur d'entreprise : JSON compressé, 64 Mo au plus. */
async function readSnapshot(req: IncomingMessage): Promise<Snapshot> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > 64 * 1024 * 1024) throw Object.assign(new Error('Copie trop volumineuse (plus de 64 Mo compressés).'), { status: 413 })
    chunks.push(c as Buffer)
  }
  try {
    const raw = Buffer.concat(chunks)
    return JSON.parse((req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw, { maxOutputLength: 1024 * 1024 * 1024 }) : raw).toString('utf8'))
  } catch {
    throw Object.assign(new Error('Copie illisible.'), { status: 400 })
  }
}

export function createCloudHandler(opts: CloudOptions): Handler {
  const { manager } = opts
  const handlers = new Map<string, { handler: Handler; password: string }>()
  const adminKey = opts.adminToken && opts.adminToken.length >= 32 ? Buffer.from(opts.adminToken) : null
  const failures = new Map<string, { n: number; since: number }>()

  const ipOf = (req: IncomingMessage) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || ''

  /** Éditeur authentifié : par le jeton du serveur, ou par son compte de la base principale. */
  async function adminOf(req: IncomingMessage): Promise<{ by: 'jeton' | 'compte'; user: SessionUser | null } | null> {
    if (!adminKey) return null
    const ip = ipOf(req)
    const f = failures.get(ip)
    if (f && Date.now() - f.since > 15 * 60_000) failures.delete(ip)
    else if (f && f.n >= 10) throw Object.assign(new Error('Trop de tentatives. Réessayez dans 15 minutes.'), { status: 429 })
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
    const got = Buffer.from(bearer)
    if (got.length === adminKey.length && timingSafeEqual(got, adminKey)) return { by: 'jeton', user: null }
    const user = bearer && opts.rootDb ? await resolveToken(opts.rootDb, bearer) : null
    if (user && isVendorAdmin(user)) return { by: 'compte', user }
    const g = failures.get(ip) ?? { n: 0, since: Date.now() }
    g.n++
    failures.set(ip, g)
    return null
  }

  async function admin(req: IncomingMessage, res: ServerResponse, path: string, url: URL) {
    if (!adminKey) return json(res, 404, { ok: false, error: "Administration désactivée : définissez ADMIN_TOKEN (32 caractères au moins) sur le serveur." })
    const who = await adminOf(req)
    if (!who) return json(res, 401, { ok: false, error: "Accès refusé : jeton d'administration ou session de l'éditeur invalide." })
    const method = req.method ?? 'GET'
    const done = (data: unknown) => json(res, 200, { ok: true, data })

    if (path === '/api/admin/me' && method === 'GET')
      return done({ by: who.by, name: who.user?.full_name ?? "Jeton d'administration", version: opts.shared.version, canIssue: !!opts.rootDb && vendorKeyAvailable() })

    // Registre des licences (base principale)
    const lic = /^\/api\/admin\/licences(?:\/(\d+)\/(revoke))?$/.exec(path)
    if (lic) {
      if (!opts.rootDb) return json(res, 404, { ok: false, error: 'Registre des licences indisponible sur ce serveur.' })
      const ctx = { db: opts.rootDb, user: who.user }
      if (!lic[1] && method === 'GET') return done(await listIssued(ctx))
      if (!lic[1] && method === 'POST') return done(await issueLicence(ctx, await readJson(req)))
      if (lic[1] && method === 'POST') return done(await revokeIssued(ctx, { id: Number(lic[1]), reason: (await readJson(req)).reason }))
      return json(res, 405, { ok: false, error: 'Méthode non autorisée.' })
    }
    /** Licence du registre → clé et numéro. */
    const fromRegistry = async (id: unknown) => {
      const row = opts.rootDb ? await opts.rootDb.one<{ licence_key: string; number: string }>('SELECT licence_key, number FROM licences_issued WHERE id = $1', [Number(id)]) : null
      if (!row) throw new Error('Licence introuvable dans le registre.')
      return row
    }

    const m = /^\/api\/admin\/tenants(?:\/([a-z][a-z0-9_]{2,30}))?(?:\/([a-z-]+))?$/.exec(path)
    if (!m) return json(res, 404, { ok: false, error: 'Ressource inconnue.' })
    const [, slug, action] = m
    if (!slug) {
      if (method === 'GET') return done(await manager.list())
      if (method === 'POST') {
        const body = await readJson(req)
        if (body.licence_id) {
          const row = await fromRegistry(body.licence_id)
          body.licence_key = row.licence_key
          body.licence_number = row.number
        }
        return done(await manager.create(body))
      }
    } else if (!action) {
      if (method === 'GET') {
        const t = await manager.get(slug)
        if (!t) return json(res, 404, { ok: false, error: `Client inconnu : ${slug}` })
        const { db_password: _p, ...row } = t
        // L'empreinte de la clé de synchronisation ne sort pas du serveur
        const { sync_key_hash, ...info } = row as typeof row & { sync_key_hash?: string | null }
        Object.assign(info, { has_sync_key: !!sync_key_hash })
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
      if (action === 'sync-key') return done(await manager.newSyncKey(slug))
      if (action === 'licence') {
        const body = await readJson(req)
        const key = body.licence_id ? (await fromRegistry(body.licence_id)).licence_key : body.licence_key
        return done(await manager.setLicence(slug, key))
      }
    }
    return json(res, 405, { ok: false, error: 'Méthode non autorisée.' })
  }

  function tenantHandler(t: TenantRow): Handler {
    const hit = handlers.get(t.slug)
    if (hit && hit.password === t.db_password) return hit.handler
    let inner: Handler | null = null
    let innerDb: Db | null = null
    const handler: Handler = async (req, res) => {
      // Demandée à chaque requête : le gestionnaire ferme les bases restées inactives et les
      // rouvre à la demande ; garder ici une base fermée rendrait le client injoignable.
      const db = await manager.db(t)
      if (!inner || db !== innerDb) {
        innerDb = db
        inner = createHandler({
          ...opts.shared,
          db,
          publicPath: `/t/${t.slug}`,
          // Lu à chaque configuration : un nouveau code remplace l'ancien sans redémarrage
          setupCode: async () => (await manager.get(t.slug))?.setup_code ?? null
        })
      }
      return inner(req, res)
    }
    handlers.set(t.slug, { handler, password: t.db_password })
    return handler
  }

  return async function cloud(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    try {
      if (path.startsWith('/api/admin/')) return await admin(req, res, path, url)
      // Console de l'éditeur : page seule, toutes les données passent par /api/admin/
      if (path === '/admin') {
        res.writeHead(301, { Location: '/admin/' })
        return void res.end()
      }
      if (path === '/admin/') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Frame-Options': 'DENY',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'"
        })
        return void res.end(adminPageHtml(opts.shared.version))
      }
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
      // Copie envoyée par le serveur de l'entreprise (clé de synchronisation de cette société)
      if (rest === '/api/mirror') {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Méthode non autorisée.' })
        const ip = ipOf(req)
        const f = failures.get(ip)
        if (f && Date.now() - f.since > 15 * 60_000) failures.delete(ip)
        else if (f && f.n >= 10) return json(res, 429, { ok: false, error: 'Trop de tentatives. Réessayez dans 15 minutes.' })
        const key = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
        if (!manager.syncKeyMatches(t, key)) {
          const g = failures.get(ip) ?? { n: 0, since: Date.now() }
          g.n++
          failures.set(ip, g)
          return json(res, 401, { ok: false, error: 'Clé de synchronisation refusée : demandez-en une nouvelle à IAM Technology.' })
        }
        return json(res, 200, { ok: true, data: await manager.receiveMirror(slug, await readSnapshot(req)) })
      }
      req.url = rest + url.search
      return await tenantHandler(t)(req, res)
    } catch (e: any) {
      if (res.headersSent) return void res.end()
      const status = Number(e?.status) || (e instanceof AppError || /inconnu|invalide|obligatoire|déjà utilisé|Confirmez|introuvable|Versions différentes|Instantané|illisible/.test(String(e?.message)) ? 400 : 500)
      if (status === 500) console.error(`[cloud ${req.method} ${path}]`, e)
      return json(res, status, { ok: false, error: status === 500 ? `Erreur du serveur : ${e?.message ?? e}` : String(e?.message ?? e) })
    }
  }
}
