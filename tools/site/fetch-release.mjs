// Copie les installateurs d'une Release GitHub (exe, dmg, apk, ipa) dans le dossier
// de téléchargement du site : ils apparaissent aussitôt sur la page « Télécharger ».
// Usage :
//   node tools/site/fetch-release.mjs <dossier> [tag|latest] [--repo proprietaire/depot] [--clean]
//   ex. node tools/site/fetch-release.mjs deploy/telechargements
// --clean retire les installateurs des versions précédentes.
// Dépôt privé : définir GITHUB_TOKEN (jeton en lecture seule).
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const args = process.argv.slice(2)
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v }
const repo = flag('--repo') ?? 'tenak27/iam_invoicer'
const clean = args.includes('--clean')
const [dir, tag = 'latest'] = args.filter((a) => a !== '--clean')
if (!dir) throw new Error('Usage : node tools/site/fetch-release.mjs <dossier> [tag|latest] [--repo proprietaire/depot] [--clean]')

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'iam-invoicer-site' }
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
const api = `https://api.github.com/repos/${repo}/releases/${tag === 'latest' ? 'latest' : 'tags/' + tag}`
const res = await fetch(api, { headers })
if (!res.ok) throw new Error(`Release introuvable (${res.status}) : ${api}`)
const release = await res.json()
const INSTALLER = /\.(exe|msi|zip|dmg|pkg|apk|ipa|appimage|deb)$/i
const assets = release.assets.filter((a) => INSTALLER.test(a.name))
if (!assets.length) throw new Error(`Aucun installateur dans la release ${release.tag_name}.`)

mkdirSync(dir, { recursive: true })
for (const a of assets) {
  const dest = join(dir, a.name)
  if (existsSync(dest) && statSync(dest).size === a.size) {
    console.log('= ' + a.name + ' (déjà présent)')
    continue
  }
  const r = await fetch(a.browser_download_url, { headers: { ...headers, Accept: 'application/octet-stream' } })
  if (!r.ok || !r.body) throw new Error(`Téléchargement impossible : ${a.name} (${r.status})`)
  // Fichier temporaire puis renommage : le site ne propose jamais un fichier à moitié copié
  await pipeline(Readable.fromWeb(r.body), createWriteStream(dest + '.part'))
  renameSync(dest + '.part', dest)
  console.log(`+ ${a.name} (${(a.size / 1048576).toFixed(1)} Mo)`)
}
if (clean) {
  const keep = new Set(assets.map((a) => a.name))
  for (const f of readdirSync(dir)) if (INSTALLER.test(f) && !keep.has(f)) { unlinkSync(join(dir, f)); console.log('- ' + f) }
}
console.log(`Release ${release.tag_name} : ${assets.length} installateur(s) dans ${dir}`)
