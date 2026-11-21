// Construit le site de présentation : site/ → out/site, icônes Phosphor insérées en SVG,
// générateur de codes QR, galerie (captures du manuel de formation) et manuels PDF.
// Usage : node tools/site/build.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as Icons from '@phosphor-icons/react'
import { build } from 'esbuild'
import { finishSite, stampAssets } from './premium.mjs'
import { writeGammeIcons } from './gamme.mjs'
import { writeLegalPages } from './legal.mjs'

const out = 'out/site'
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync('site', out, { recursive: true })

// Codes QR (téléchargement sur téléphone) : bibliothèque « qrcode » regroupée en un fichier
await build({
  stdin: { contents: "import QRCode from 'qrcode'; window.QRCode = QRCode", resolveDir: process.cwd() },
  bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2017', outfile: `${out}/qrcode.js`, logLevel: 'warning'
})

// Galerie d'écrans et manuels
const GALLERY = ['tableau-de-bord', 'facture', 'mise-en-page', 'caisse', 'stock', 'bilan', 'rh-paie', 'projet-taches', 'roles']
mkdirSync(`${out}/assets/galerie`, { recursive: true })
for (const g of GALLERY) {
  cpSync(`docs/formation/captures/${g}.jpg`, `${out}/assets/galerie/${g}.jpg`)
  // Aperçu mobile du même écran (galerie « Le logiciel tel qu'il est »)
  if (existsSync(`docs/formation/captures/mobile-${g}.jpg`)) cpSync(`docs/formation/captures/mobile-${g}.jpg`, `${out}/assets/galerie/mobile-${g}.jpg`)
}
mkdirSync(`${out}/docs`, { recursive: true })
// Le guide d'installation (serveurs, Docker, NAS) reste réservé à l'équipe : seul le manuel de formation est publié
for (const d of ['IAM-INVOICER-Manuel-de-formation.pdf'])
  if (existsSync(`docs/${d}`)) cpSync(`docs/${d}`, `${out}/docs/${d}`)

// Les images sont servies avec un cache d'un an : le numéro de version dans leur adresse
// force leur rechargement à chaque nouvelle version (__VERSION__ dans index.html).
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
let html = readFileSync('site/index.html', 'utf8').replaceAll('__VERSION__', version)
const missing = new Set()
html = html.replace(/<i data-icon="([A-Za-z]+)"(?: data-size="(\d+)")?(?: data-weight="([a-z]+)")?><\/i>/g, (_, name, size, weight) => {
  const Icon = Icons[name]
  if (!Icon) {
    missing.add(name)
    return ''
  }
  return renderToStaticMarkup(createElement(Icon, { size: Number(size ?? 20), weight: weight ?? (size ? 'duotone' : 'bold'), 'aria-hidden': true }))
})
if (missing.size) throw new Error('Icônes inconnues : ' + [...missing].join(', '))
// Finition commune des sites et survol réservé à la souris (tools/site/premium.mjs)
html = await finishSite(html, 'invoicer')
// Icônes de la gamme (liste des logiciels de la barre du haut et du pied de page)
await writeGammeIcons(out)
// Pages légales communes (confidentialité, conditions, mentions légales, cookies) dans /legal/
writeLegalPages(out, { app: 'IAM INVOICER', host: 'invoice.iamtechnology.store', icon: '/assets/iam-invoicer-favicon.png' })
// Image d'aperçu des liens partagés (WhatsApp, Facebook) : l'icône du logiciel, 512 px
cpSync('assets/marques/iam-invoicer-icone.png', `${out}/assets/iam-invoicer-icone.png`)
// Empreinte dans l'adresse des images et des scripts, servis avec un cache d'un an
const finalHtml = stampAssets(html, out)
writeFileSync(`${out}/index.html`, finalHtml)
// Vraie page 404, habillée comme le site : contenu principal remplacé, non indexée.
// Servie avec le statut 404 par le serveur (src/server/app.ts).
{
  const mStart = finalHtml.indexOf('>', finalHtml.indexOf('<main')) + 1
  const mEnd = finalHtml.lastIndexOf('</main>')
  if (mStart > 0 && mEnd > mStart) {
    const block = '\n<section class="wrap" style="min-height:52vh;display:grid;place-content:center;text-align:center;gap:14px;padding:12vh 0"><p style="font-size:clamp(3rem,12vw,5rem);font-weight:800;margin:0;line-height:1">404</p><h1 style="margin:0">Cette page est introuvable</h1><p>La page que vous cherchez a changé d’adresse ou n’existe plus.</p><p><a class="btn btn-cta" href="/">Retour à l’accueil</a></p></section>\n'
    const page404 = (finalHtml.slice(0, mStart) + block + finalHtml.slice(mEnd))
      .replace(/<title>[^<]*<\/title>/, '<title>Page introuvable — IAM INVOICER</title>')
      .replace(/<meta name="robots"[^>]*>\s*/g, '')
      .replace('</title>', '</title>\n<meta name="robots" content="noindex">')
    writeFileSync(`${out}/404.html`, page404)
  }
}
console.log(`Site construit dans ${out}`)
