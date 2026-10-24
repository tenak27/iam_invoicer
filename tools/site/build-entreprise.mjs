// Construit le site d'IAM Technology (iamtechnology.store) : site-entreprise/ → out/site-entreprise.
// Même charte que le site d'IAM INVOICER : on reprend son <head> (styles), son illustration d'accueil
// et ses déchirures de papier, puis on y place le contenu de site-entreprise/body.html.
// Usage : node tools/site/build-entreprise.mjs
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as Icons from '@phosphor-icons/react'
import { finishSite } from './premium.mjs'

// « node tools/site/build-entreprise.mjs mails » : site d'IAM MAILS (site-mails/ → out/site-mails)
// « node tools/site/build-entreprise.mjs btp » : site d'IAM BTP (site-btp/ → out/site-btp)
const MAILS = process.argv[2] === 'mails'
const BTP = process.argv[2] === 'btp'
// « node tools/site/build-entreprise.mjs ecommerce » : site d'IAM E-COMMERCE (site-ecommerce/ → out/site-ecommerce)
const ECOM = process.argv[2] === 'ecommerce'
// « node tools/site/build-entreprise.mjs reminder » : site d'IAM REMINDER (site-reminder/ → out/site-reminder)
const REMINDER = process.argv[2] === 'reminder'
// « node tools/site/build-entreprise.mjs education » : site d'IAM EDUCATION (site-education/ → out/site-education)
const EDU = process.argv[2] === 'education'
// « node tools/site/build-entreprise.mjs cloud » : site d'IAM CLOUD (site-cloud/ → out/site-cloud)
const CLOUD = process.argv[2] === 'cloud'
// « node tools/site/build-entreprise.mjs sante » : site d'IAM SANTÉ (site-sante/ → out/site-sante)
const SANTE = process.argv[2] === 'sante'
// « node tools/site/build-entreprise.mjs location » : site d'IAM LOCATION (site-location/ → out/site-location)
const LOCATION = process.argv[2] === 'location'
const V = LOCATION
  ? {
      dir: 'site-location',
      out: 'out/site-location',
      assets: ['iam-location.svg', 'iam-location-mark.svg'],
      title: 'IAM LOCATION — Gestion locative : loyers, quittances, baux et locataires | IAM Technology',
      description: "IAM LOCATION : biens et locataires, encaissement des loyers en espèces, Orange Money, Moov Money ou Wave, quittances PDF avec QR code, baux conformes à la loi n°103-2015/CNT, états des lieux, réparations et relances WhatsApp. Pour les propriétaires et les agences du Burkina Faso.",
      ogTitle: 'IAM LOCATION — Vos loyers encaissés, sans courir après',
      icon: 'iam-location-mark.svg'
    }
  : SANTE
  ? {
      dir: 'site-sante',
      out: 'out/site-sante',
      assets: ['iam-sante.svg', 'iam-sante-mark.svg'],
      title: 'IAM SANTÉ — Dossier patient électronique des formations sanitaires | IAM Technology',
      description: "IAM SANTÉ : identifiant national de santé (NNIS), accueil et file d'attente, consultations CIM-10, laboratoire, pharmacie, caisse CNAMU et gratuité, surveillance des MDO et rapport mensuel pour ENDOS. Pour les CSPS, CM, CMA, hôpitaux et cliniques du Burkina Faso.",
      ogTitle: 'IAM SANTÉ — Un patient, un dossier, dans toutes les structures',
      icon: 'iam-sante-mark.svg'
    }
  : CLOUD
  ? {
      dir: 'site-cloud',
      out: 'out/site-cloud',
      assets: ['iam-cloud.svg', 'iam-cloud-mark.svg'],
      title: 'IAM CLOUD — Fichiers, documents, discussions et tâches de votre équipe | IAM Technology',
      description: "IAM CLOUD : stockage et partage de fichiers chiffrés, documents rédigés à plusieurs en temps réel, discussions d'équipe, tâches en Kanban, notifications. Facturé en FCFA, pour les entreprises et administrations du Burkina Faso.",
      ogTitle: 'IAM CLOUD — Vos fichiers et votre équipe, au même endroit',
      icon: 'iam-cloud-mark.svg'
    }
  : EDU
  ? {
      dir: 'site-education',
      out: 'out/site-education',
      assets: ['iam-education.svg', 'iam-education-mark.svg'],
      title: 'IAM EDUCATION — Gestion scolaire complète : notes, bulletins, absences, frais | IAM Technology',
      description: "IAM EDUCATION : élèves et classes, saisie des notes et bulletins (moyennes, coefficients, rangs), appel et absences, discipline, frais de scolarité et paiements Orange Money, Moov Money, Wave, salaires, portail parent. Pour les écoles, collèges et lycées du Burkina Faso.",
      ogTitle: 'IAM EDUCATION — Toute votre école dans une seule application',
      icon: 'iam-education-mark.svg'
    }
  : REMINDER
  ? {
      dir: 'site-reminder',
      out: 'out/site-reminder',
      assets: ['iam-reminder.svg', 'iam-reminder-mark.svg'],
      title: 'IAM REMINDER — Vos commissions rappelées sur le chemin du retour | IAM Technology',
      description: "IAM REMINDER vous rappelle vos commissions (pain, pressing, pharmacie…) à 5 km de la maison, sur le trajet du retour du travail. Notification et lecture vocale, sans GPS en continu, vos données restent sur votre téléphone.",
      ogTitle: 'IAM REMINDER — N’oubliez plus rien en rentrant',
      icon: 'iam-reminder-mark.svg'
    }
  : ECOM
  ? {
      dir: 'site-ecommerce',
      out: 'out/site-ecommerce',
      assets: ['iam-ecommerce.svg', 'iam-ecommerce-mark.svg'],
      title: 'IAM E-COMMERCE — Votre boutique en ligne en 5 minutes | IAM Technology',
      description: 'IAM E-COMMERCE : créez votre boutique en ligne, partagez son lien sur WhatsApp et Facebook, recevez les commandes, gérez le stock et vos clients. Paiement à la livraison, Orange Money, Moov Money, Wave.',
      ogTitle: 'IAM E-COMMERCE — Votre boutique en ligne en 5 minutes',
      icon: 'iam-ecommerce-mark.svg'
    }
  : BTP
  ? {
      dir: 'site-btp',
      out: 'out/site-btp',
      assets: ['iam-btp.svg', 'iam-btp-mark.svg'],
      title: 'IAM BTP — Suivi de chantiers et gestion du parc de machines | IAM Technology',
      description: "IAM BTP : avancement des chantiers, rapports photo du jour, dépenses et budget, pointage et paie des ouvriers, parc d'engins (heures, carburant, entretien, locations). Pour les entreprises du BTP et ceux qui font construire.",
      ogTitle: 'IAM BTP — Vos chantiers et vos machines, sous contrôle',
      icon: 'iam-btp-mark.svg'
    }
  : MAILS
  ? {
      dir: 'site-mails',
      out: 'out/site-mails',
      assets: ['iam-mails.svg', 'iam-mails-mark.svg'],
      title: 'IAM MAILS — Toutes vos boîtes mail réunies, triées et résumées | IAM Technology',
      description: 'IAM MAILS réunit Gmail, Outlook, Yahoo, iCloud et votre messagerie pro : tableau de bord, désabonnement en un geste, réponses automatiques et synthèse quotidienne.',
      ogTitle: 'IAM MAILS — Toutes vos boîtes mail réunies',
      icon: 'iam-mails-mark.svg'
    }
  : {
      dir: 'site-entreprise',
      out: 'out/site-entreprise',
      assets: ['iam-technology.svg', 'iam-technology-mark.svg', 'iam-invoicer.svg', 'iam-mails.svg', 'iam-btp.svg', 'iam-ecommerce.svg', 'iam-reminder.svg', 'iam-education.svg', 'iam-cloud.svg', 'iam-sante.svg', 'iam-location.svg', 'faso-artisans.png'],
      title: 'IAM Technology — Solutions informatiques, domotique, sécurité et logiciels | Ouagadougou',
      description: "IAM TECHNOLOGY accompagne votre entreprise vers l'excellence technologique : solutions informatiques, domotique, sécurité et surveillance, logiciels IAM INVOICER, IAM MAILS, IAM BTP, IAM E-COMMERCE, IAM REMINDER, IAM EDUCATION, IAM CLOUD, IAM SANTÉ, IAM LOCATION et FASO ARTISANS. Ouagadougou, depuis 2013.",
      ogTitle: 'IAM Technology — Transformez votre vision digitale en réalité',
      icon: 'iam-technology-mark.svg'
    }
const out = V.out
rmSync(out, { recursive: true, force: true })
mkdirSync(`${out}/assets`, { recursive: true })
for (const f of V.assets) cpSync(`assets/marques/${f}`, `${out}/assets/${f}`)
// Icône du logiciel (dessinée) : onglet du navigateur et écran d'accueil d'iOS
const slug = V.icon.replace(/-mark\.svg$/, '')
for (const f of [`${slug}-favicon.png`, `${slug}-apple-touch.png`]) cpSync(`assets/marques/${f}`, `${out}/assets/${f}`)
if (MAILS) cpSync('site-mails/captures', `${out}/assets/captures`, { recursive: true })
if (BTP) cpSync('site-btp/captures', `${out}/assets/captures`, { recursive: true })
if (ECOM) cpSync('site-ecommerce/captures', `${out}/assets/captures`, { recursive: true })
if (REMINDER) cpSync('site-reminder/captures', `${out}/assets/captures`, { recursive: true })
if (EDU) cpSync('site-education/captures', `${out}/assets/captures`, { recursive: true })
if (CLOUD) cpSync('site-cloud/captures', `${out}/assets/captures`, { recursive: true })
if (SANTE) cpSync('site-sante/captures', `${out}/assets/captures`, { recursive: true })
if (LOCATION) cpSync('site-location/captures', `${out}/assets/captures`, { recursive: true })
// Animation des marques (page autonome, intégrée au site d'IAM Technology dans un cadre)
const ENTREPRISE = !MAILS && !BTP && !ECOM && !REMINDER && !EDU && !CLOUD && !SANTE && !LOCATION
// Le site d'IAM Technology est servi tel quel par nginx : sa politique de contenu est dans la page,
// avec l'empreinte de chaque script intégré (les sites des logiciels la reçoivent de leur serveur)
function withCsp(page) {
  const hashes = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`)
  const csp = `default-src 'self'; script-src 'self' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'`
  return page.replace(/<meta charset="?utf-?8"?>/i, (m) => `${m}<meta http-equiv="Content-Security-Policy" content="${csp}">`)
}
if (ENTREPRISE) {
  writeFileSync(`${out}/marques.html`, withCsp(readFileSync('site-entreprise/marques.html', 'utf8').replace(/\r\n?/g, '\n')))
  for (const f of ['iam-technology-mark.svg']) cpSync(`assets/marques/${f}`, `${out}/assets/${f}`)
}

const src = readFileSync('site/index.html', 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error(`Repère introuvable dans site/index.html : ${from}`)
  return src.slice(a, b)
}

const head = src
  .slice(0, src.indexOf('</head>'))
  .replace(/<title>[^<]*<\/title>/, `<title>${V.title}</title>`)
  .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${V.description}">`)
  .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${V.ogTitle}">`)
  .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${V.description}">`)
  .replace(/<link rel="icon"[^>]*>(\s*<link rel="apple-touch-icon"[^>]*>)?/, `<link rel="icon" href="assets/${V.icon.replace(/-mark\.svg$/, '')}-favicon.png" type="image/png">
<link rel="apple-touch-icon" href="assets/${V.icon.replace(/-mark\.svg$/, '')}-apple-touch.png">`)

// Illustration d'accueil (Awa, avion, nuages) sans le sceau propre au logiciel
const heroArt = cut('<div class="hero-art" aria-hidden="true">', '<div class="seal">')
const tearTop = cut('<svg class="tear tear-top"', '</svg>') + '</svg>'
const tearBottom = cut('<svg class="tear tear-bottom"', '</svg>') + '</svg>'
// Illustration de la section contact (paysage, Awa)
const contactArt = cut('<div class="contact-art rv">', '<div class="contact-card')

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
let body = readFileSync(`${V.dir}/body.html`, 'utf8')
  .replace('{{HERO_ART}}', heroArt)
  .replaceAll('{{TEAR_TOP}}', tearTop)
  .replaceAll('{{TEAR_BOTTOM}}', tearBottom)
  .replace('{{CONTACT_ART}}', contactArt)
  .replaceAll('__VERSION__', version)

// Aperçu de l'application : les captures deviennent une vitrine (onglets + grande fenêtre de
// navigateur à l'adresse du logiciel), en HTML statique ; le script commun gère les onglets.
const host = ENTREPRISE ? 'iamtechnology.store' : `${V.dir.replace('site-', '')}.iamtechnology.store`
body = body.replace(/<div class="shots">([\s\S]*?)\n\s*<\/div>/, (whole, inner) => {
  const figs = [...inner.matchAll(/<figure[^>]*>\s*<img ([^>]*)>\s*<figcaption><b>([^<]*)<\/b>([^<]*)<\/figcaption>\s*<\/figure>/g)]
  if (figs.length < 2) return whole
  const tabs = figs.map(([, , title, text], i) => `<button type="button" role="tab" id="vit-t${i}" aria-controls="vit-p${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><b>${title}</b>${text}<i aria-hidden="true"></i></button>`)
  const shots = figs.map(([, attrs], i) => `<img ${attrs.replace(/\s*loading="lazy"/, '')}${i ? ' loading="lazy"' : ''} id="vit-p${i}" role="tabpanel" aria-labelledby="vit-t${i}"${i ? '' : ' class="on"'}>`)
  return `<div class="vit rv" data-vit>
        <div class="vit-tabs" role="tablist" aria-label="Écrans de l’application">
          ${tabs.join('\n          ')}
        </div>
        <div class="vit-window">
          <div class="vit-bar" aria-hidden="true"><span></span><span></span><span></span><em>${host}/app</em></div>
          <div class="vit-screens">
            ${shots.join('\n            ')}
          </div>
        </div>
      </div>`
})

// Tarifs : la liste « Formule : prix » devient des cartes (prix en grand, bouton d'essai ou de contact)
const essai = /<a class="btn btn-cta[^"]*" href="([^"]+)"/.exec(body)?.[1] ?? '#contact'
body = body.replace(/(<section id="tarifs"[\s\S]*?)<ol class="feat-list">([\s\S]*?)<\/ol>/, (whole, before, inner) => {
  const items = [...inner.matchAll(/<b>([^<]*)<\/b><small>([^<]*)<\/small>/g)]
  if (items.length < 2) return whole
  const cards = items.map(([, label, desc], i) => {
    let [name, price] = label.includes(' : ') ? label.split(' : ') : [label, '']
    const asked = /^(Sur devis|Sur demande)\s*:\s*/i.exec(desc)
    if (!price && asked) [price, desc] = [asked[1], desc.slice(asked[0].length)]
    if (!price && /gratuit/i.test(name)) price = 'Gratuit'
    const m = /^(dès\s+)?([\d\s ]+)\s*(FCFA)?\s*(\/\s*\S+)?$/i.exec(price.trim())
    const amount = m
      ? `${m[1] ? `<small>${m[1].trim()}</small> ` : ''}${m[2].trim()}${m[3] ? ` <span>${m[3]}</span>` : ''}${m[4] ? ` <em>${m[4].replace(/\s+/g, ' ')}</em>` : ''}`
      : price.charAt(0).toUpperCase() + price.slice(1)
    const contact = /devis|demande/i.test(price)
    const cta = contact ? `<a class="btn btn-ghost sm" href="#contact">Nous contacter</a>` : `<a class="btn btn-cta sm" href="${essai}">Essai gratuit</a>`
    return `<article class="prix-card rv${i === 1 ? ' mis-en-avant' : ''}" role="listitem" style="--d:${i}"><h3>${name}</h3><p class="prix-montant">${amount}</p><p class="prix-desc">${desc.charAt(0).toUpperCase() + desc.slice(1)}</p>${cta}</article>`
  })
  return `${before}<div class="prix" role="list">\n        ${cards.join('\n        ')}\n      </div>`
})

// Rythme : une section de cartes numérotées sur deux devient un « fil » (en-tête à gauche qui reste à
// l'écran, étapes reliées en liste à droite), quand elle ne contient que son en-tête et ses étapes
let stepSections = 0
body = body.replace(/<section([^>]*)>([\s\S]*?)<\/section>/g, (whole, attrs, inner) => {
  if (!inner.includes('<div class="steps">')) return whole
  if (stepSections++ % 2 === 0) return whole
  const blocks = [...inner.matchAll(/^ {6}<\w+[^>]*class="([^" ]+)/gm)].map((m) => m[1])
  if (blocks[0] !== 'head' || blocks.slice(1).some((b) => b !== 'steps')) return whole
  const open = /class="([^"]*)"/.test(attrs) ? attrs.replace(/class="([^"]*)"/, 'class="$1 fil"') : `${attrs} class="fil"`
  return `<section${open}>${inner}</section>`
})

const script = `<script>
(function () {
  var $ = function (id) { return document.getElementById(id) }
  var all = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)) }
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  $('year').textContent = new Date().getFullYear()
  var toggle = document.querySelector('.menu-toggle'), menu = $('menu')
  toggle.addEventListener('click', function () { var o = menu.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(o)) })
  menu.addEventListener('click', function (e) { if (e.target.closest('a')) { menu.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false') } })
  var io = 'IntersectionObserver' in window && !reduce ? new IntersectionObserver(function (es) {
    es.forEach(function (en) {
      if (!en.isIntersecting) return
      en.target.classList.add('in')
      Array.prototype.slice.call(en.target.querySelectorAll('[data-count]')).forEach(function (c) {
        var end = +c.dataset.count, t0 = performance.now()
        ;(function tick(t) { var k = Math.min((t - t0) / 1400, 1); c.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick) })(t0)
      })
      io.unobserve(en.target)
    })
  }, { threshold: .14 }) : null
  all('.rv').forEach(function (el) { io ? io.observe(el) : el.classList.add('in') })
  var rot = all('#rot span'), ri = 0
  if (rot.length > 1 && !reduce) setInterval(function () {
    if (document.hidden) return
    var cur = rot[ri]; ri = (ri + 1) % rot.length
    cur.className = 'out'; rot[ri].className = 'on'
    setTimeout(function () { cur.className = '' }, 750)
  }, 2600)
  var nav = $('nav'), read = $('read'), top = $('to-top'), queued = false
  function frame() {
    queued = false
    var y = scrollY, h = document.documentElement.scrollHeight - innerHeight
    read.style.transform = 'scaleX(' + (h > 0 ? Math.min(Math.max(y / h, 0), 1) : 0) + ')'
    nav.classList.toggle('solid', y > 40)
    top.classList.toggle('on', y > innerHeight * 1.2)
  }
  addEventListener('scroll', function () { if (!queued) { queued = true; requestAnimationFrame(frame) } }, { passive: true })
  top.addEventListener('click', function () { scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }) })
  frame()
  // Vitrine de l'aperçu : onglets (clic, flèches du clavier) et avance automatique pilotée par la
  // fin du trait de progression (en pause au survol), lancée quand la vitrine arrive à l'écran
  all('[data-vit]').forEach(function (box) {
    var tabs = Array.prototype.slice.call(box.querySelectorAll('[role="tab"]'))
    var imgs = Array.prototype.slice.call(box.querySelectorAll('.vit-screens img'))
    var cur = 0, auto = !reduce
    function show(i, focus) {
      cur = (i + tabs.length) % tabs.length
      tabs.forEach(function (t, k) { var on = k === cur; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1 })
      imgs.forEach(function (im, k) { im.classList.toggle('on', k === cur) })
      if (focus) tabs[cur].focus()
      if (auto) { box.classList.remove('auto'); void box.offsetWidth; box.classList.add('auto') }
    }
    function stop() { auto = false; box.classList.remove('auto') }
    tabs.forEach(function (t, k) { t.addEventListener('click', function () { stop(); show(k) }) })
    box.querySelector('[role="tablist"]').addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
      if (d) { e.preventDefault(); stop(); show(cur + d, true) }
    })
    box.addEventListener('animationend', function (e) { if (auto && e.animationName === 'vit-fill' && !document.hidden) show(cur + 1) })
    if (auto && 'IntersectionObserver' in window) {
      var seen = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { seen.disconnect(); show(0) } }, { threshold: .35 })
      seen.observe(box)
    }
  })
  requestAnimationFrame(function () { document.body.classList.add('ready') })
})()
</script>`

const extra = readFileSync('site-entreprise/extra.css', 'utf8')
let html = `${head}<style>
${extra}</style>
</head>
<body id="top">
<a class="skip" href="#contenu">Aller au contenu</a>
<div class="read" id="read" aria-hidden="true"></div>
${body}
${script}
${ENTREPRISE ? '' : '<script src="socle-telechargements.js" defer></script>'}
</body>
</html>
`
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
html = await finishSite(html.replace(/\r\n?/g, '\n'))
writeFileSync(`${out}/index.html`, ENTREPRISE ? withCsp(html) : html)
console.log(`Site construit dans ${out}`)
