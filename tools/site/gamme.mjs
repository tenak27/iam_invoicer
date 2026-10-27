// La gamme d'IAM Technology sur chaque site (appelé par premium.mjs pour INVOICER, IAM Technology et les
// sites des logiciels) :
//   - un bouton « Nos logiciels » dans la barre du haut, qui ouvre la liste de tous les logiciels (site et
//     accès direct à l'application) ;
//   - « Télécharger » dans le menu des sections, avec son icône ;
//   - dans le menu replié (téléphone, tablette) : Télécharger, Se connecter, Version démo en vrais boutons ;
//   - sur téléphone, un bouton de connexion toujours visible dans la barre du haut ;
//   - en pied de page, la bande de toute la gamme (le logiciel visité est signalé).
// Les icônes (96 px) sont gardées dans assets/gamme/ et copiées par writeGammeIcons() dans le site
// construit (sans dépendance d'image : l'image Docker d'INVOICER construit aussi son site).
// `node tools/site/gamme.mjs` les refait depuis les logos (assets/marques), avec sharp.
import { cpSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const MARQUES = fileURLToPath(new URL('../../assets/marques/', import.meta.url))
const ICONS = fileURLToPath(new URL('../../assets/gamme/', import.meta.url))

export const GAMME = [
  { key: 'invoicer', name: 'IAM INVOICER', url: 'https://invoice.iamtechnology.store/', say: 'Facturation, caisse, stock, comptabilité' },
  { key: 'mails', name: 'IAM MAILS', url: 'https://mails.iamtechnology.store/', say: 'Toutes vos boîtes mail réunies' },
  { key: 'btp', name: 'IAM BTP', url: 'https://btp.iamtechnology.store/', say: 'Chantiers et parc d’engins' },
  { key: 'ecommerce', name: 'IAM E-COMMERCE', url: 'https://ecommerce.iamtechnology.store/', say: 'Votre boutique en ligne' },
  { key: 'reminder', name: 'IAM REMINDER', url: 'https://reminder.iamtechnology.store/', say: 'Le bon rappel au bon endroit' },
  { key: 'education', name: 'IAM EDUCATION', url: 'https://education.iamtechnology.store/', say: 'Toute la gestion de l’école' },
  { key: 'cloud', name: 'IAM CLOUD', url: 'https://cloud.iamtechnology.store/', say: 'Fichiers et travail d’équipe' },
  { key: 'sante', name: 'IAM SANTÉ', url: 'https://sante.iamtechnology.store/', say: 'Dossier patient électronique' },
  { key: 'location', name: 'IAM LOCATION', url: 'https://location.iamtechnology.store/', say: 'Gestion locative' },
  { key: 'artisans', name: 'FASO ARTISANS', url: 'https://artisans-bf.com/', say: 'Artisans vérifiés près de chez vous' }
]
const source = (key) => MARQUES + (key === 'artisans' ? 'faso-artisans.png' : `iam-${key}-apple-touch.png`)

/** Icônes de la gamme (carrées, 96 px) dans <outDir>/assets/gamme/<clé>.png. */
export async function writeGammeIcons(outDir) {
  mkdirSync(`${outDir}/assets/gamme`, { recursive: true })
  for (const g of GAMME) cpSync(`${ICONS}${g.key}.png`, `${outDir}/assets/gamme/${g.key}.png`)
}

// Lancé directement : icônes refaites depuis les logos
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sharp = require('sharp')
  mkdirSync(ICONS, { recursive: true })
  for (const g of GAMME) await sharp(source(g.key)).resize(96, 96).png({ compressionLevel: 9 }).toFile(`${ICONS}${g.key}.png`)
  console.log(`Icônes de la gamme refaites dans ${ICONS}`)
}

const ICON = {
  grid: '<svg width="22" height="22" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor"><path d="M104 40H56a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16Zm0 64H56V56h48Zm96-64h-48a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16Zm0 64h-48V56h48Zm-96 32H56a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16v-48a16 16 0 0 0-16-16Zm0 64H56v-48h48Zm96-64h-48a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16v-48a16 16 0 0 0-16-16Zm0 64h-48v-48h48Z"/></svg>',
  download: '<svg width="18" height="18" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor"><path d="M224 144v64a8 8 0 0 1-8 8H40a8 8 0 0 1-8-8v-64a8 8 0 0 1 16 0v56h160v-56a8 8 0 0 1 16 0Zm-101.66 5.66a8 8 0 0 0 11.32 0l40-40a8 8 0 0 0-11.32-11.32L136 124.69V32a8 8 0 0 0-16 0v92.69L93.66 98.34a8 8 0 0 0-11.32 11.32Z"/></svg>',
  user: '<svg width="22" height="22" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor"><path d="M230.92 212c-15.23-26.33-38.7-45.21-66.09-54.16a72 72 0 1 0-73.66 0C63.78 166.78 40.31 185.66 25.08 212a8 8 0 1 0 13.85 8c18.84-32.56 52.14-52 89.07-52s70.23 19.44 89.07 52a8 8 0 1 0 13.85-8ZM72 96a56 56 0 1 1 56 56 56.06 56.06 0 0 1-56-56Z"/></svg>',
  arrow: '<svg width="16" height="16" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor"><path d="M221.66 133.66l-72 72a8 8 0 0 1-11.32-11.32L196.69 136H40a8 8 0 0 1 0-16h156.69l-58.35-58.34a8 8 0 0 1 11.32-11.32l72 72a8 8 0 0 1 0 11.32Z"/></svg>',
  open: '<svg width="16" height="16" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor"><path d="M141.66 133.66l-40 40a8 8 0 0 1-11.32-11.32L116.69 136H24a8 8 0 0 1 0-16h92.69L90.34 93.66a8 8 0 0 1 11.32-11.32l40 40a8 8 0 0 1 0 11.32ZM192 32h-56a8 8 0 0 0 0 16h56v160h-56a8 8 0 0 0 0 16h56a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16Z"/></svg>'
}

/** Ajoute la gamme, les boutons Télécharger et de connexion au HTML d'un site (current : clé du site visité). */
export function injectGamme(html, current) {
  const here = (g) => g.key === current
  const hasDownloads = /<section[^>]*id="telecharger"/.test(html)
  // ── Liste des logiciels (barre du haut) : le site, et l'accès direct à l'application ──
  const apps = GAMME.map((g) => `<li${here(g) ? ' class="here"' : ''}><a class="gamme-app" href="${here(g) ? '#top' : g.url}"${here(g) ? ' aria-current="page"' : ''}><img src="assets/gamme/${g.key}.png" alt="" width="40" height="40" loading="lazy"><span><b>${g.name}</b><small>${here(g) ? 'Vous êtes ici' : g.say}</small></span></a><a class="gamme-open" href="${g.url}app/" aria-label="Ouvrir l’application ${g.name}" title="Ouvrir l’application">${ICON.open}</a></li>`).join('')
  const panel = `<div class="gamme-scrim" hidden></div><div class="gamme" id="gamme" role="dialog" aria-label="Les logiciels d’IAM Technology" hidden><p class="gamme-t">Les logiciels d’IAM Technology</p><ul class="gamme-grid">${apps}</ul><a class="gamme-all" href="https://iamtechnology.store/">IAM Technology, l’entreprise ${ICON.arrow}</a></div>`
  // ── Menu des sections : « Télécharger » avec son icône, puis les vrais boutons du menu replié ──
  const act = /<div class="nav-act">([\s\S]*?)<button type="button" class="menu-toggle"/.exec(html)?.[1] ?? ''
  html = html.replace(/(<nav class="menu" id="menu"[^>]*>)([\s\S]*?)(<\/nav>)/, (all, open, links, close) => {
    let l = links
    if (hasDownloads) {
      if (/href="#telecharger"/.test(l)) l = l.replace(/<a href="#telecharger">([^<]*)<\/a>/, `<a href="#telecharger" class="menu-dl">${ICON.download}$1</a>`)
      else l = l.replace(/(\s*)(<a href="#contact">)/, `$1<a href="#telecharger" class="menu-dl">${ICON.download}Télécharger</a>$1$2`)
    }
    // Boutons du menu replié, repris de la barre (adresses et attributs propres à chaque site)
    const btns = []
    if (hasDownloads) btns.push(`<a class="btn btn-cta" href="#telecharger">${ICON.download}Télécharger l’application</a>`)
    for (const m of act.matchAll(/<a class="(nav-link|btn btn-cta sm)" href="([^"]*)"([^>]*)>([^<]+)<\/a>/g)) {
      if (m[2].startsWith('tel:')) continue
      btns.push(`<a class="btn ${hasDownloads || m[1] === 'nav-link' ? 'btn-ghost' : 'btn-cta'}" href="${m[2]}"${m[3]}>${m[4]}</a>`)
    }
    return `${open}${l}<div class="menu-extra">${btns.join('')}<button type="button" class="menu-gamme" data-gamme>${ICON.grid}Nos autres logiciels</button></div>${close}`
  })
  // ── Barre du haut : connexion toujours visible sur téléphone, bouton de la gamme, panneau ──
  html = html.replace(/(<div class="nav-act">)([\s\S]*?)(<button type="button" class="menu-toggle"[\s\S]*?<\/button>\s*<\/div>)/, (all, open, inner, rest) => {
    const login = /<a class="nav-link" href="([^"]*)"([^>]*)>Se connecter<\/a>/.exec(inner)
    const loginIcon = login ? `<a class="nav-login" href="${login[1]}"${login[2]} aria-label="Se connecter" title="Se connecter">${ICON.user}</a>` : ''
    return `${open}${inner}${loginIcon}<button type="button" class="apps-toggle" aria-expanded="false" aria-controls="gamme" aria-label="Nos logiciels" title="Nos logiciels">${ICON.grid}</button>${rest}`
  })
  // Panneau après la barre, pas dedans : le flou de la barre (backdrop-filter) enfermerait sa position fixe
  html = html.replace(/(<header class="nav" id="nav">[\s\S]*?<\/header>)/, `$1\n${panel}`)
  // ── Pied de page : toute la gamme (le site d'IAM Technology la présente déjà) ──
  if (current !== 'technology') {
    const chips = GAMME.map((g) => `<a class="gamme-chip${here(g) ? ' here' : ''}" href="${here(g) ? '#top' : g.url}"${here(g) ? ' aria-current="page"' : ''}><img src="assets/gamme/${g.key}.png" alt="" width="32" height="32" loading="lazy"><span>${g.name}</span></a>`).join('')
    html = html.replace(/<footer id="pied">/, `<footer id="pied">\n  <div class="wrap gamme-band"><h4>Les logiciels d’IAM Technology</h4><div class="gamme-row">${chips}</div></div>`)
    // L'ancienne colonne partielle (deux logiciels seulement) mène désormais à l'entreprise
    html = html.replace(/<div><h4>IAM Technology<\/h4>[\s\S]*?<\/div>/, '<div><h4>IAM Technology</h4><a href="https://iamtechnology.store/">L’entreprise</a><a href="https://iamtechnology.store/#logiciels">Tous nos logiciels</a><a href="https://iamtechnology.store/#contact">Nous contacter</a></div>')
  }
  return html
}
