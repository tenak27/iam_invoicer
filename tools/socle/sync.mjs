// Recopie la base commune (tools/socle) dans les applications IAM.
//   node tools/socle/sync.mjs            toutes les applications
//   node tools/socle/sync.mjs iam-btp    une seule
// Serveur : tools/socle/server → src/server/socle ; interface : tools/socle/renderer → src/renderer/src/socle.
// IAM INVOICER (ce dépôt) a déjà ses propres téléchargements et sa fenêtre de mise à jour :
// il ne reçoit que le tactile et les styles communs.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const docs = resolve(here, '../../..')
export const APPS = ['iam-mails', 'iam-btp', 'iam-ecommerce', 'iam-reminder', 'iam-education', 'iam-cloud', 'iam-sante', 'iam-location', 'faso-artisans']
const SELF = 'iam-erp'

function copyDir(from, to, only) {
  mkdirSync(to, { recursive: true })
  let n = 0
  for (const f of readdirSync(from)) {
    if (only && !only.includes(f)) continue
    const src = join(from, f)
    const dst = join(to, f)
    if (existsSync(dst) && readFileSync(dst).equals(readFileSync(src))) continue
    copyFileSync(src, dst)
    n++
  }
  return n
}

const wanted = process.argv.slice(2)
for (const app of [...APPS, SELF]) {
  if (wanted.length && !wanted.includes(app)) continue
  const root = join(docs, app)
  if (!existsSync(root)) {
    console.warn(`${app} : dossier absent`)
    continue
  }
  let n = 0
  if (app === SELF) n += copyDir(join(here, 'renderer'), join(root, 'src/renderer/src/socle'), ['touch.ts', 'socle.css'])
  else {
    n += copyDir(join(here, 'server'), join(root, 'src/server/socle'))
    n += copyDir(join(here, 'renderer'), join(root, 'src/renderer/src/socle'))
  }
  console.log(`${app.padEnd(14)} ${n ? n + ' fichier(s) mis à jour' : 'à jour'}`)
}
