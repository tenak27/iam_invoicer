// Construit le site d'IAM Technology (iamtechnology.store) : site-entreprise/ → out/site-entreprise.
// Même charte que le site d'IAM INVOICER : on reprend son <head> (styles), son illustration d'accueil
// et ses déchirures de papier, puis on y place le contenu de site-entreprise/body.html.
// Usage : node tools/site/build-entreprise.mjs
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as Icons from '@phosphor-icons/react'

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
const V = SANTE
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
      assets: ['iam-technology.svg', 'iam-technology-mark.svg', 'iam-invoicer.svg', 'iam-mails.svg', 'iam-btp.svg', 'iam-ecommerce.svg', 'iam-reminder.svg', 'iam-education.svg', 'iam-cloud.svg', 'iam-sante.svg'],
      title: 'IAM Technology — Solutions informatiques, domotique, sécurité et logiciels | Ouagadougou',
      description: "IAM TECHNOLOGY accompagne votre entreprise vers l'excellence technologique : solutions informatiques, domotique, sécurité et surveillance, logiciels IAM INVOICER, IAM MAILS, IAM BTP, IAM E-COMMERCE, IAM REMINDER, IAM EDUCATION, IAM CLOUD et IAM SANTÉ. Ouagadougou, depuis 2013.",
      ogTitle: 'IAM Technology — Transformez votre vision digitale en réalité',
      icon: 'iam-technology-mark.svg'
    }
const out = V.out
rmSync(out, { recursive: true, force: true })
mkdirSync(`${out}/assets`, { recursive: true })
for (const f of V.assets) cpSync(`assets/marques/${f}`, `${out}/assets/${f}`)
if (MAILS) cpSync('site-mails/captures', `${out}/assets/captures`, { recursive: true })
if (BTP) cpSync('site-btp/captures', `${out}/assets/captures`, { recursive: true })
if (ECOM) cpSync('site-ecommerce/captures', `${out}/assets/captures`, { recursive: true })
if (REMINDER) cpSync('site-reminder/captures', `${out}/assets/captures`, { recursive: true })
if (EDU) cpSync('site-education/captures', `${out}/assets/captures`, { recursive: true })
if (CLOUD) cpSync('site-cloud/captures', `${out}/assets/captures`, { recursive: true })
if (SANTE) cpSync('site-sante/captures', `${out}/assets/captures`, { recursive: true })
// Animation des marques (page autonome, intégrée au site d'IAM Technology dans un cadre)
const ENTREPRISE = !MAILS && !BTP && !ECOM && !REMINDER && !EDU && !CLOUD && !SANTE
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
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="assets/${V.icon}" type="image/svg+xml">`)

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
html = html.replace(/\r\n?/g, '\n')
writeFileSync(`${out}/index.html`, ENTREPRISE ? withCsp(html) : html)
console.log(`Site construit dans ${out}`)
