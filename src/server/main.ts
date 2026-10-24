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
//   ADMIN_TOKEN     (PostgreSQL) active l'hébergement de plusieurs clients, une base chacun,
//                   sous /t/<client>, et l'API /api/admin/ (jeton de 32 caractères au moins)
//   SETUP_CODE      code exigé pour la première configuration de la base principale (recommandé)
//   ADMIN_DATABASE_URL  compte PostgreSQL qui crée les bases des clients (DATABASE_URL par défaut)
//   SECRETS_KEY     clé de chiffrement des secrets enregistrés en base (openssl rand -hex 32) ;
//                   SECRETS_KEY_FILE : la même, lue dans un fichier. À sauvegarder à part de la base.
//   TRUST_PROXY     0 si le serveur est joint directement, sans nginx ni Caddy devant lui (1 par défaut)
//   API_RATE_PER_MINUTE requêtes d'API par minute et par adresse avant refus (3000)
//   CLOUD_MIRROR_URL    serveur installé dans l'entreprise : adresse de sa base en ligne (https://…/t/<société>)
//   CLOUD_MIRROR_KEY    clé de synchronisation de cette base ; CLOUD_MIRROR_MINUTES : intervalle (15 par défaut)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { openDb } from '../main/db'
import { createHandler } from './app'
import { dbConfigFromEnv } from './config'
import { configureVendorKey } from '../main/services/licensing'
import { createCloudHandler } from './cloud'
import { pgProvisioner, TenantManager } from './tenants'
import { MirrorLoop } from '../main/mirror'
import { readFileSync } from 'node:fs'
import { configureSecretKey, sealAll, secretKeyAvailable } from '../main/secretbox'
import { restrictOutbound } from '../main/outbound'

declare const __APP_VERSION__: string

async function main() {
  const cfg = dbConfigFromEnv(process.env)
  configureVendorKey(process.env.LICENCE_PRIVATE_KEY_FILE)
  configureSecretKey(process.env.SECRETS_KEY_FILE ? readFileSync(process.env.SECRETS_KEY_FILE, 'utf8') : process.env.SECRETS_KEY)
  const trustProxy = process.env.TRUST_PROXY !== '0'
  const db = await openDb(cfg)
  if (secretKeyAvailable()) {
    const n = await sealAll(db)
    if (n) console.log(`Secrets chiffrés : ${n} valeur(s) en clair converties.`)
  } else console.warn('SECRETS_KEY absente : les secrets enregistrés en base (messagerie, SMS, jetons) ne sont pas chiffrés.')
  const root = createHandler({
    db,
    version: __APP_VERSION__,
    webRoot: process.env.WEB_ROOT ?? join(__dirname, '../web'),
    siteRoot: process.env.SITE_ROOT ?? join(__dirname, '../site'),
    downloadsDir: process.env.DOWNLOADS_DIR ?? join(process.env.DATA_DIR ?? 'data', 'telechargements'),
    corsOrigin: process.env.CORS_ORIGIN,
    trustProxy,
    ratePerMinute: Number(process.env.API_RATE_PER_MINUTE) || undefined,
    // Première configuration de la base principale réservée à qui connaît SETUP_CODE
    setupCode: process.env.SETUP_CODE ? async () => process.env.SETUP_CODE! : undefined
  })
  // Hébergement multi-clients : une base PostgreSQL par client
  let handler: (req: IncomingMessage, res: ServerResponse) => Promise<unknown> = root
  let manager: TenantManager | null = null
  if (process.env.ADMIN_TOKEN) {
    if (cfg.mode !== 'server') throw new Error('ADMIN_TOKEN (plusieurs clients) exige PostgreSQL : définissez DATABASE_URL.')
    if (process.env.ADMIN_TOKEN.length < 32) throw new Error('ADMIN_TOKEN trop court : 32 caractères au moins (ex. openssl rand -hex 32).')
    // Sociétés hébergées : leurs réglages (passerelle SMS, SMTP, SECeF) ne doivent pas atteindre le réseau interne du serveur
    restrictOutbound(true)
    const prov = pgProvisioner(process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL!)
    await prov.protectDatabase(cfg.database)
    manager = new TenantManager(db, prov)
    await manager.init()
    handler = createCloudHandler({
      root,
      manager,
      adminToken: process.env.ADMIN_TOKEN,
      rootDb: db,
      // Inscription libre des sociétés depuis le site (SIGNUP=off pour la fermer)
      selfSignup: process.env.SIGNUP !== 'off',
      demo: process.env.DEMO !== 'off',
      shared: { version: __APP_VERSION__, webRoot: process.env.WEB_ROOT ?? join(__dirname, '../web'), corsOrigin: process.env.CORS_ORIGIN, trustProxy, ratePerMinute: Number(process.env.API_RATE_PER_MINUTE) || undefined }
    })
    console.log(`Hébergement multi-clients actif : ${(await manager.list()).length} client(s), adresses /t/<client>`)
  }
  // Copie en ligne : ce serveur d'entreprise envoie régulièrement sa base à sa base hébergée
  if (process.env.CLOUD_MIRROR_URL && process.env.CLOUD_MIRROR_KEY) {
    const mirror = new MirrorLoop(() => db, () => {
      const s = mirror.state()
      if (s.lastError) console.warn(`Copie en ligne : ${s.lastError}`)
    })
    mirror.configure({ url: process.env.CLOUD_MIRROR_URL, key: process.env.CLOUD_MIRROR_KEY, minutes: Number(process.env.CLOUD_MIRROR_MINUTES) || 15 })
    console.log(`Copie en ligne active vers ${process.env.CLOUD_MIRROR_URL}`)
  }
  const port = Number(process.env.PORT) || 8080
  const host = process.env.HOST ?? '0.0.0.0'
  // Vérification toutes les 5 s : une connexion qui traîne est fermée peu après son délai
  const server = createServer({ connectionsCheckingInterval: 5_000 }, handler)
  // Connexions lentes ou abandonnées : libérées sans attendre (attaques par épuisement des connexions)
  server.headersTimeout = 20_000
  server.requestTimeout = 200_000
  server.keepAliveTimeout = 65_000
  server.maxHeadersCount = 100
  server.listen(port, host, () => {
    console.log(`IAM INVOICER ${__APP_VERSION__} — http://${host}:${port} — base ${cfg.mode === 'server' ? `PostgreSQL ${cfg.host}` : `intégrée (${cfg.dataDir})`}`)
  })
  const stop = () => server.close(() => Promise.all([manager?.closeAll(), db.close()]).finally(() => process.exit(0)))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main().catch((e) => {
  console.error('Démarrage impossible :', e)
  process.exit(1)
})
