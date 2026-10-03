// Démarrage du serveur IAM INVOICER.
//
// Variables d'environnement :
//   PORT            port d'écoute (8080)
//   HOST            adresse d'écoute (0.0.0.0)
//   DATABASE_URL    postgres://utilisateur:motdepasse@hote:5432/base  (recommandé)
//   DATA_DIR        sans DATABASE_URL : base PostgreSQL intégrée dans ce dossier (./data)
//   WEB_ROOT        dossier de l'application web (out/web à côté du serveur)
//   SITE_ROOT       site de présentation servi à la racine (out/site) ; l'application passe sous /app/
//   DOWNLOADS_DIR   installateurs proposés au téléchargement (DATA_DIR/telechargements par défaut)
//   CORS_ORIGIN     origines autorisées pour l'API (* par défaut)
//   LICENCE_PRIVATE_KEY_FILE  serveur de l'éditeur uniquement : clé privée pour émettre les licences

import { createServer } from 'node:http'
import { join } from 'node:path'
import { openDb } from '../main/db'
import { createHandler } from './app'
import { dbConfigFromEnv } from './config'
import { configureVendorKey } from '../main/services/licensing'

declare const __APP_VERSION__: string

async function main() {
  const cfg = dbConfigFromEnv(process.env)
  configureVendorKey(process.env.LICENCE_PRIVATE_KEY_FILE)
  const db = await openDb(cfg)
  const handler = createHandler({
    db,
    version: __APP_VERSION__,
    webRoot: process.env.WEB_ROOT ?? join(__dirname, '../web'),
    siteRoot: process.env.SITE_ROOT ?? join(__dirname, '../site'),
    downloadsDir: process.env.DOWNLOADS_DIR ?? join(process.env.DATA_DIR ?? 'data', 'telechargements'),
    corsOrigin: process.env.CORS_ORIGIN
  })
  const port = Number(process.env.PORT) || 8080
  const host = process.env.HOST ?? '0.0.0.0'
  const server = createServer(handler)
  server.listen(port, host, () => {
    console.log(`IAM INVOICER ${__APP_VERSION__} — http://${host}:${port} — base ${cfg.mode === 'server' ? `PostgreSQL ${cfg.host}` : `intégrée (${cfg.dataDir})`}`)
  })
  const stop = () => server.close(() => db.close().finally(() => process.exit(0)))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main().catch((e) => {
  console.error('Démarrage impossible :', e)
  process.exit(1)
})
