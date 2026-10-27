// La gamme d'IAM Technology sur le site de FASO ARTISANS (faso-artisans/site/index.html, page écrite à la
// main, hors de la chaîne build-entreprise.mjs) : bouton « Nos logiciels » et sa liste, connexion
// toujours visible sur téléphone, menu du téléphone (sections, Télécharger, Version démo, Se connecter),
// bande de la gamme en pied de page. Les blocs sont délimités par des repères <!--gamme:…--> : relancer
// le script les remplace (liste tenue à jour depuis gamme.mjs).
// Usage : node tools/site/faso-gamme.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { GAMME, writeGammeIcons } from './gamme.mjs'

const SITE = 'C:/Users/konat/Documents/faso-artisans/site'
const FILE = `${SITE}/index.html`
let html = readFileSync(FILE, 'utf8').replace(/\r\n?/g, '\n')

const grid = '<svg width="22" height="22" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor"><path d="M104 40H56a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16Zm0 64H56V56h48Zm96-64h-48a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16Zm0 64h-48V56h48Zm-96 32H56a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16v-48a16 16 0 0 0-16-16Zm0 64H56v-48h48Zm96-64h-48a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16v-48a16 16 0 0 0-16-16Zm0 64h-48v-48h48Z"/></svg>'
const user = '<svg width="22" height="22" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor"><path d="M230.92 212c-15.23-26.33-38.7-45.21-66.09-54.16a72 72 0 1 0-73.66 0C63.78 166.78 40.31 185.66 25.08 212a8 8 0 1 0 13.85 8c18.84-32.56 52.14-52 89.07-52s70.23 19.44 89.07 52a8 8 0 1 0 13.85-8ZM72 96a56 56 0 1 1 56 56 56.06 56.06 0 0 1-56-56Z"/></svg>'
const list = '<svg width="22" height="22" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor"><path d="M224 128a8 8 0 0 1-8 8H40a8 8 0 0 1 0-16h176a8 8 0 0 1 8 8ZM40 72h176a8 8 0 0 0 0-16H40a8 8 0 0 0 0 16Zm176 112H40a8 8 0 0 0 0 16h176a8 8 0 0 0 0-16Z"/></svg>'
const open = '<svg width="16" height="16" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor"><path d="M141.66 133.66l-40 40a8 8 0 0 1-11.32-11.32L116.69 136H24a8 8 0 0 1 0-16h92.69L90.34 93.66a8 8 0 0 1 11.32-11.32l40 40a8 8 0 0 1 0 11.32ZM192 32h-56a8 8 0 0 0 0 16h56v160h-56a8 8 0 0 0 0 16h56a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16Z"/></svg>'
const here = (g) => g.key === 'artisans'

const apps = GAMME.map((g) => `<li${here(g) ? ' class="here"' : ''}><a class="g-app" href="${here(g) ? '#' : g.url}"${here(g) ? ' aria-current="page"' : ''}><img src="assets/gamme/${g.key}.png" alt="" width="40" height="40" loading="lazy"><span><b>${g.name}</b><small>${here(g) ? 'Vous êtes ici' : g.say}</small></span></a><a class="g-open" href="${g.url}app/" aria-label="Ouvrir l’application ${g.name}" title="Ouvrir l’application">${open}</a></li>`).join('')
const NAV = `<a class="fa-login" href="/app/#/connexion" aria-label="Se connecter" title="Se connecter">${user}</a><button type="button" class="fa-apps" aria-expanded="false" aria-controls="fa-gamme" aria-label="Nos logiciels" title="Nos logiciels">${grid}</button><button type="button" class="fa-burger" aria-expanded="false" aria-controls="fa-menu" aria-label="Ouvrir le menu">${list}</button>`
const PANELS = `<div class="fa-scrim" hidden></div>
<div class="fa-gamme" id="fa-gamme" role="dialog" aria-label="Les logiciels d’IAM Technology" hidden><p class="g-t">Les logiciels d’IAM Technology</p><ul class="g-grid">${apps}</ul><a class="g-all" href="https://iamtechnology.store/">IAM Technology, l’entreprise →</a></div>
<div class="fa-menu" id="fa-menu" hidden><a href="#comment">Comment ça marche</a><a href="#artisans">Artisans</a><a href="#telecharger">Télécharger</a><div class="fa-menu-btns"><a class="btn btn-green" href="#telecharger">Télécharger l’application</a><a class="btn btn-soft" href="/app/#/demo">Version démo</a><a class="btn btn-soft" href="/app/#/connexion">Se connecter</a><button type="button" class="fa-menu-gamme">${grid}Nos autres logiciels</button></div></div>`
const chips = GAMME.map((g) => `<a class="g-chip${here(g) ? ' here' : ''}" href="${here(g) ? '#' : g.url}"${here(g) ? ' aria-current="page"' : ''}><img src="assets/gamme/${g.key}.png" alt="" width="32" height="32" loading="lazy"><span>${g.name}</span></a>`).join('')
const PIED = `<div class="wrap g-band"><h4>Les logiciels d’IAM Technology</h4><div class="g-row">${chips}</div></div>`
const CSS = `
  /* ── La gamme d'IAM Technology (tools/site/faso-gamme.mjs dans iam-erp) ── */
  .fa-login, .fa-apps, .fa-burger { flex: none; display: inline-grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; border: 0; background: rgba(13, 59, 120, .07); color: var(--navy); cursor: pointer; transition: background-color .2s ease, transform 160ms cubic-bezier(.23, 1, .32, 1); }
  .fa-apps[aria-expanded='true'], .fa-burger[aria-expanded='true'] { background: var(--navy); color: #fff; }
  .fa-login:active, .fa-apps:active, .fa-burger:active { transform: scale(.94); }
  .fa-login, .fa-burger { display: none; }
  .fa-gamme { position: fixed; z-index: 30; top: 76px; right: 16px; width: min(620px, calc(100vw - 24px)); padding: 16px; border-radius: 24px; background: #fff; box-shadow: 0 30px 70px -24px rgba(13, 59, 120, .45), 0 0 0 1px rgba(13, 59, 120, .06); transform-origin: calc(100% - 60px) -8px; animation: gamme-pop .18s cubic-bezier(.23, 1, .32, 1); }
  .fa-gamme[hidden], .fa-menu[hidden], .fa-scrim { display: none; }
  @keyframes gamme-pop { from { opacity: 0; transform: translateY(-4px) scale(.97); } }
  .g-t { margin: 2px 6px 10px; color: var(--muted); font-size: .76rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .g-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
  .g-grid li { display: flex; align-items: center; border-radius: 16px; transition: background-color .15s ease; }
  .g-grid li.here { background: rgba(27, 110, 243, .07); }
  .g-app { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 8px 6px 8px 8px; min-height: 56px; color: var(--ink); text-decoration: none; }
  .g-app img { flex: none; width: 40px; height: 40px; border-radius: 12px; box-shadow: 0 6px 14px -8px rgba(13, 59, 120, .55); }
  .g-app span { min-width: 0; display: grid; }
  .g-app b { font-size: .9rem; }
  .g-app small { color: var(--muted); font-size: .76rem; line-height: 1.3; }
  .g-open { flex: none; display: grid; place-items: center; width: 36px; height: 36px; margin-right: 6px; border-radius: 50%; color: var(--navy); background: rgba(13, 59, 120, .07); }
  .g-all { display: flex; justify-content: center; align-items: center; margin-top: 10px; min-height: 44px; border-radius: 14px; background: var(--bg); color: var(--navy); font-weight: 700; font-size: .9rem; text-decoration: none; }
  .fa-menu { position: fixed; z-index: 30; top: 70px; left: 12px; right: 12px; display: grid; padding: 10px; border-radius: 22px; background: #fff; box-shadow: 0 30px 70px -24px rgba(13, 59, 120, .45); animation: gamme-pop .18s cubic-bezier(.23, 1, .32, 1); transform-origin: top right; }
  .fa-menu > a { display: flex; align-items: center; min-height: 48px; padding: 0 14px; border-radius: 14px; color: var(--ink); font-weight: 600; text-decoration: none; }
  .fa-menu-btns { display: grid; gap: 8px; margin-top: 8px; padding-top: 12px; border-top: 1px solid rgba(13, 59, 120, .1); }
  .fa-menu-btns .btn { min-height: 48px; border-radius: 16px; }
  .btn-soft { background: var(--bg); color: var(--ink) !important; }
  .fa-menu-gamme { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; border: 0; border-radius: 16px; background: transparent; color: var(--navy); font: inherit; font-weight: 700; cursor: pointer; }
  .g-band { padding: 22px 0 18px; }
  .g-band h4 { margin: 0 0 12px; color: var(--navy); font-size: .78rem; letter-spacing: .1em; text-transform: uppercase; }
  .g-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
  .g-chip { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 12px 8px 8px; border-radius: 16px; background: #fff; border: 1px solid rgba(13, 59, 120, .08); color: var(--ink); font-size: .86rem; font-weight: 700; white-space: nowrap; text-decoration: none; }
  .g-chip img { flex: none; width: 32px; height: 32px; border-radius: 10px; }
  .g-chip.here { border-color: var(--blue); background: rgba(27, 110, 243, .06); }
  @media (hover: hover) and (pointer: fine) { .g-grid li:hover { background: var(--bg); } .g-chip:hover { border-color: rgba(27, 110, 243, .4); } .fa-apps:hover, .fa-login:hover, .fa-burger:hover { background: rgba(13, 59, 120, .14); } }
  @media (max-width: 900px) { .fa-burger { display: inline-grid; } }
  @media (max-width: 560px) {
    nav.top a.fa-login { display: inline-grid; }
    nav.top { gap: 8px; }
    nav.top .btn-primary { display: none; }
    .fa-gamme { position: fixed; top: auto !important; bottom: 0; left: 0; right: 0 !important; width: auto; max-height: 82vh; overflow-y: auto; overscroll-behavior: contain; border-radius: 26px 26px 0 0; padding: 18px 14px calc(18px + env(safe-area-inset-bottom)); animation: gamme-sheet .34s cubic-bezier(.32, .72, 0, 1); }
    .fa-scrim:not([hidden]) { display: block; position: fixed; inset: 0; z-index: 29; background: rgba(8, 16, 42, .45); }
    .g-grid { grid-template-columns: 1fr; }
    .g-row { grid-template-columns: 1fr 1fr; }
    @keyframes gamme-sheet { from { transform: translateY(100%); } }
  }
  @media (prefers-reduced-motion: reduce) { .fa-gamme, .fa-menu { animation: none; } }
`
const JS = `<script>
  // Gamme d'IAM Technology et menu du téléphone : un seul panneau ouvert à la fois ; Échap, un lien ou un toucher à côté le ferme
  (function () {
    var g = document.getElementById('fa-gamme'), m = document.getElementById('fa-menu'), s = document.querySelector('.fa-scrim')
    var ga = document.querySelector('.fa-apps'), mb = document.querySelector('.fa-burger')
    if (!g || !m) return
    var head = document.querySelector('header')
    function show(which, keyboard) {
      // Sous l'en-tête, alignés sur son contenu (panneaux placés hors de l'en-tête : son flou ne les enferme pas)
      var r = head.getBoundingClientRect(), w = head.querySelector('.wrap').getBoundingClientRect()
      g.style.top = m.style.top = (r.bottom + 6) + 'px'
      g.style.right = Math.max(12, innerWidth - w.right) + 'px'
      g.hidden = which !== 'g'; m.hidden = which !== 'm'; s.hidden = which !== 'g'
      ga.setAttribute('aria-expanded', String(which === 'g')); mb.setAttribute('aria-expanded', String(which === 'm'))
      if (keyboard && which) { var f = (which === 'g' ? g : m).querySelector('a'); if (f) f.focus() }
    }
    ga.addEventListener('click', function (e) { e.stopPropagation(); show(g.hidden ? 'g' : null, e.detail === 0) })
    mb.addEventListener('click', function (e) { e.stopPropagation(); show(m.hidden ? 'm' : null, e.detail === 0) })
    document.querySelector('.fa-menu-gamme').addEventListener('click', function (e) { e.stopPropagation(); show('g', e.detail === 0) })
    ;[g, m].forEach(function (p) { p.addEventListener('click', function (e) { if (e.target.closest('a')) show(null) }) })
    document.addEventListener('click', function (e) { if (!g.contains(e.target) && !m.contains(e.target)) show(null) })
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && (!g.hidden || !m.hidden)) show(null) })
  })()
</script>`

function block(name, content, insert, css = false) {
  // Dans une feuille de style, un repère HTML serait lu comme du CSS (et invaliderait la règle suivante)
  const [a, b] = css ? [`/*gamme:${name}*/`, `/*/gamme:${name}*/`] : [`<!--gamme:${name}-->`, `<!--/gamme:${name}-->`]
  const start = html.indexOf(a)
  const end = html.indexOf(b, start)
  const wrapped = `${a}${content}${b}`
  if (start >= 0 && end > start) html = html.slice(0, start) + wrapped + html.slice(end + b.length)
  else {
    const before = html
    html = insert(html, wrapped)
    if (html === before) throw new Error(`repère introuvable pour le bloc ${name}`)
  }
}
// Première version (repères HTML dans la feuille, panneaux dans l'en-tête) : retirée avant d'insérer
html = html.replace(/<!--gamme:css-->[\s\S]*?<!--\/gamme:css-->\n?/, '').replace(/<!--gamme:panneaux-->[\s\S]*?<!--\/gamme:panneaux-->/, '')
block('css', CSS, (h, w) => h.replace(/\n<\/style>/, `\n${w}\n</style>`), true)
block('nav', NAV, (h, w) => h.replace(/(<a class="btn btn-primary" href="\/app\/#\/inscription">Créer mon compte<\/a>)(\s*<\/nav>)/, `$1${w}$2`))
// Panneaux après l'en-tête (le flou de l'en-tête enfermerait une position fixe)
block('panneaux', PANELS, (h, w) => h.replace(/<\/header>\n/, `</header>\n${w}\n`))
block('pied', PIED, (h, w) => h.replace(/<footer>\n/, `<footer>\n${w}\n`))
block('js', JS, (h, w) => h.replace(/(<script src="socle-telechargements\.js" defer><\/script>)/, `${w}\n$1`))
writeFileSync(FILE, html)
await writeGammeIcons(SITE)
console.log('gamme ajoutée au site de FASO ARTISANS')
