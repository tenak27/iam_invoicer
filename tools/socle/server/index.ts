// Base commune des serveurs IAM : la source est iam-erp/tools/socle, recopiée dans chaque
// application par sync.mjs. Ne pas modifier ici : modifier la source puis relancer la copie.
//
//   GET /api/downloads        version du serveur et installateurs proposés (contrôle des mises à jour)
//   GET /telechargements/…    installateurs, avec reprise (quand nginx ne les sert pas lui-même)
//   /api/socle/…              notifications : fil des applications installées, Web Push (notify.ts)
//   /api/socle/demo           version de démonstration (demo.ts)
//   /api/socle/licence        licence de l'espace client, formules et paiement (licence.ts)
//   /api/socle/integrations   clés d'API, webhooks et leur verrouillage ; /api/v1/… pour les logiciels tiers (integrations.ts)
//
// Branchement dans app.ts, avant les autres routes :  if (await socle(req, res, path)) return
// Notifier depuis un service :  import { notify } from '../socle' ; notify([userId], { title, body, url })
// Prévenir les webhooks :        import { emitEvent } from '../socle' ; emitEvent(espace, 'order.created', { … })
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ConsoleAgent } from './agent'
import { DemoService, type DemoSeed } from './demo'
import { IntegrationsService, type IntegrationsConfig } from './integrations'
import { LicenceService, type LicenceConfig } from './licence'
export { purgeRows, spaceDemo, userDemo } from './demo'
export { emitEvent, IntegrationLock, LOCKED_MESSAGE, UNLOCK_BLOCKED, UNLOCK_REFUSED, UNLOCK_REFUSED_CODE } from './integrations'
import { listDownloads, serveDownload } from './downloads'
import { Notifier, type Notice, type SocleDb } from './notify'

export type { Notice } from './notify'
export type { DemoSeed } from './demo'
export type { LicenceConfig, LicenceState } from './licence'
export type { IntegrationsConfig, LockState } from './integrations'

export interface SocleOptions {
  /** Nom affiché de l'application (IAM BTP, Faso Artisans…). */
  app: string
  version: string
  /** Dossier des installateurs (DOWNLOADS_DIR par défaut). */
  downloadsDir?: string
  /** Base et sessions : notifications (fil et Web Push). */
  db?: SocleDb
  resolveUser?: (token: string) => Promise<{ id: number } | null | undefined>
  /** Faux : l'application envoie elle-même ses Web Push (IAM CLOUD) ; le fil reste servi. */
  webPush?: boolean
  /** Version de démonstration (navigateur) : espaces fictifs séparés, effacés après 24 heures. */
  demo?: { seed: DemoSeed; token: (userId: number) => Promise<string> }
  /** Licences vendues par la console : limites appliquées, formules et paiement, guide après paiement. */
  licence?: LicenceConfig
  /** Clés d'API et webhooks de l'espace client, verrouillables (Paramètres → API et webhooks). */
  integrations?: IntegrationsConfig
}

export type SocleHandler = ((req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean>) & { notifier: Notifier | null; agent: ConsoleAgent | null; licence: LicenceService | null; integrations: IntegrationsService | null }

let current: Notifier | null = null

/** Notifie des utilisateurs (sans attendre ; sans effet tant que le serveur n'est pas démarré, ex. tests). */
export function notify(userIds: number[], n: Notice) {
  current?.notifyQuietly(userIds, n)
}

export function createSocle(opts: SocleOptions): SocleHandler {
  const dir = opts.downloadsDir ?? process.env.DOWNLOADS_DIR
  const notifier = opts.db && opts.resolveUser ? new Notifier({ db: opts.db, app: opts.app, resolveUser: opts.resolveUser, webPush: opts.webPush }) : null
  if (notifier) {
    current = notifier
    notifier.init().catch((e) => console.warn('Notifications indisponibles :', e?.message ?? e))
  }
  // Console d'IAM Technology : mesures et journal, seulement avec CONSOLE_TOKEN
  const agent = opts.db && process.env.CONSOLE_TOKEN ? new ConsoleAgent({ db: opts.db, app: opts.app, version: opts.version, token: process.env.CONSOLE_TOKEN }) : null
  const demo = opts.demo && opts.resolveUser ? new DemoService({ seed: opts.demo.seed, token: opts.demo.token, resolveUser: opts.resolveUser }) : null
  const licence = opts.licence && opts.db && opts.resolveUser ? new LicenceService({ db: opts.db, app: opts.app, config: opts.licence, resolveUser: opts.resolveUser }) : null
  const integrations = opts.integrations && opts.db && opts.resolveUser ? new IntegrationsService({ db: opts.db, app: opts.app, config: opts.integrations, resolveUser: opts.resolveUser, notify, enforce: licence ? (u, n, a) => licence.enforce(u, n, a) : undefined }) : null
  const socle = async function socle(req: IncomingMessage, res: ServerResponse, path: string) {
    agent?.watch(res)
    if (demo && path.startsWith('/api/socle/demo')) {
      const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || ''
      if (await demo.handle(req, res, path, ip)) return true
    }
    if (licence && path.startsWith('/api/socle/licence')) return licence.handle(req, res, path)
    if (integrations && (path.startsWith('/api/socle/integrations') || path.startsWith('/api/v1/'))) return integrations.handle(req, res, path)
    if (path.startsWith('/api/socle/console/')) {
      if (agent) return agent.handle(req, res, path)
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'Ressource inconnue.' }))
      return true
    }
    if (notifier && path.startsWith('/api/socle/')) return notifier.handle(req, res, path)
    if (req.method !== 'GET' && req.method !== 'HEAD') return false
    if (path === '/api/downloads') {
      const files = await listDownloads(dir)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ ok: true, data: { app: opts.app, version: opts.version, files } }))
      return true
    }
    if (path.startsWith('/telechargements/')) return serveDownload(req, res, dir, path)
    return false
  } as SocleHandler
  socle.notifier = notifier
  socle.agent = agent
  socle.licence = licence
  socle.integrations = integrations
  return socle
}
