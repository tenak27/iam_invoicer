// Base commune des serveurs IAM : la source est iam-erp/tools/socle, recopiée dans chaque
// application par sync.mjs. Ne pas modifier ici : modifier la source puis relancer la copie.
//
//   GET /api/downloads        version du serveur et installateurs proposés (contrôle des mises à jour)
//   GET /telechargements/…    installateurs, avec reprise (quand nginx ne les sert pas lui-même)
//   /api/socle/…              notifications : fil des applications installées, Web Push (notify.ts)
//
// Branchement dans app.ts, avant les autres routes :  if (await socle(req, res, path)) return
// Notifier depuis un service :  import { notify } from '../socle' ; notify([userId], { title, body, url })
import type { IncomingMessage, ServerResponse } from 'node:http'
import { listDownloads, serveDownload } from './downloads'
import { Notifier, type Notice, type SocleDb } from './notify'

export type { Notice } from './notify'

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
}

export type SocleHandler = ((req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean>) & { notifier: Notifier | null }

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
  const socle = async function socle(req: IncomingMessage, res: ServerResponse, path: string) {
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
  return socle
}
