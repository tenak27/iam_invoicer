// Base commune des serveurs IAM : la source est iam-erp/tools/socle, recopiée dans chaque
// application par sync.mjs. Ne pas modifier ici : modifier la source puis relancer la copie.
//
//   GET /api/downloads        version du serveur et installateurs proposés (contrôle des mises à jour)
//   GET /telechargements/…    installateurs, avec reprise (quand nginx ne les sert pas lui-même)
//
// Branchement dans app.ts, avant les autres routes :  if (await socle(req, res, path)) return
import type { IncomingMessage, ServerResponse } from 'node:http'
import { listDownloads, serveDownload } from './downloads'

export interface SocleOptions {
  /** Nom affiché de l'application (IAM BTP, Faso Artisans…). */
  app: string
  version: string
  /** Dossier des installateurs (DOWNLOADS_DIR par défaut). */
  downloadsDir?: string
}

export type SocleHandler = (req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean>

export function createSocle(opts: SocleOptions): SocleHandler {
  const dir = opts.downloadsDir ?? process.env.DOWNLOADS_DIR
  return async function socle(req, res, path) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false
    if (path === '/api/downloads') {
      const files = await listDownloads(dir)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ ok: true, data: { app: opts.app, version: opts.version, files } }))
      return true
    }
    if (path.startsWith('/telechargements/')) return serveDownload(req, res, dir, path)
    return false
  }
}
