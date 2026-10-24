// Recopie la base commune (tools/socle) dans les applications IAM.
//   node tools/socle/sync.mjs            toutes les applications
//   node tools/socle/sync.mjs iam-btp    une seule
//   server/*.ts          → src/server/socle/
//   renderer/*.ts(x),css → src/renderer/src/socle/
//   renderer/public/…    → src/renderer/public/… (service worker des notifications)
//   desktop/background.ts → src/desktop/socle.ts (application de bureau en arrière-plan)
//   android/*.java       → android/app/src/main/java/<paquet>/ (notifications en arrière-plan),
//                          paquet tiré de l'appId de capacitor.config.ts
// IAM INVOICER (ce dépôt) a déjà ses propres téléchargements et sa fenêtre de mise à jour : il ne
// reçoit que le tactile et les styles communs. IAM REMINDER a ses propres notifications natives
// (rappels géolocalisés) : pas de service Android ni de bureau.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const docs = resolve(here, '../../..')
export const APPS = ['iam-mails', 'iam-btp', 'iam-ecommerce', 'iam-reminder', 'iam-education', 'iam-cloud', 'iam-sante', 'iam-location', 'faso-artisans']
const SELF = 'iam-erp'
const NO_BACKGROUND = new Set(['iam-reminder'])

let changed = 0
function put(src, dst, transform) {
  const content = transform ? transform(readFileSync(src, 'utf8')) : readFileSync(src)
  if (existsSync(dst) && readFileSync(dst).equals(Buffer.from(content))) return
  mkdirSync(dirname(dst), { recursive: true })
  writeFileSync(dst, content)
  changed++
}
function copyTree(from, to, filter = () => true) {
  for (const f of readdirSync(from)) {
    const src = join(from, f)
    if (statSync(src).isDirectory()) copyTree(src, join(to, f), filter)
    else if (filter(f)) put(src, join(to, f))
  }
}

const wanted = process.argv.slice(2)
for (const app of [...APPS, SELF]) {
  if (wanted.length && !wanted.includes(app)) continue
  const root = join(docs, app)
  if (!existsSync(root)) {
    console.warn(`${app} : dossier absent`)
    continue
  }
  changed = 0
  if (app === SELF) {
    for (const f of ['touch.ts', 'socle.css']) put(join(here, 'renderer', f), join(root, 'src/renderer/src/socle', f))
  } else {
    copyTree(join(here, 'server'), join(root, 'src/server/socle'))
    for (const f of readdirSync(join(here, 'renderer'))) if (/\.(tsx?|css)$/.test(f)) put(join(here, 'renderer', f), join(root, 'src/renderer/src/socle', f))
    copyTree(join(here, 'renderer/public'), join(root, 'src/renderer/public'))
    if (!NO_BACKGROUND.has(app)) {
      if (existsSync(join(root, 'src/desktop'))) put(join(here, 'desktop/background.ts'), join(root, 'src/desktop/socle.ts'))
      const cap = existsSync(join(root, 'capacitor.config.ts')) ? readFileSync(join(root, 'capacitor.config.ts'), 'utf8') : ''
      const appId = /appId:\s*'([^']+)'/.exec(cap)?.[1]
      if (appId && existsSync(join(root, 'android'))) {
        const dir = join(root, 'android/app/src/main/java', ...appId.split('.'))
        for (const f of readdirSync(join(here, 'android'))) put(join(here, 'android', f), join(dir, f), (s) => s.replace('package __PACKAGE__;', `package ${appId};`))
      }
    }
  }
  console.log(`${app.padEnd(14)} ${changed ? changed + ' fichier(s) mis à jour' : 'à jour'}`)
}
