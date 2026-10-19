// Construit le site d'IAM Technology (iamtechnology.store) : site-entreprise/ → out/site-entreprise.
// Même charte que le site d'IAM INVOICER : on reprend son <head> (styles), son illustration d'accueil
// et ses déchirures de papier, puis on y place le contenu de site-entreprise/body.html.
// Usage : node tools/site/build-entreprise.mjs
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as Icons from '@phosphor-icons/react'

// « node tools/site/build-entreprise.mjs mails » : site d'IAM MAILS (site-mails/ → out/site-mails)
// « node tools/site/build-entreprise.mjs btp » : site d'IAM BTP (site-btp/ → out/site-btp)
const MAILS = process.argv[2] === 'mails'
const BTP = process.argv[2] === 'btp'
const V = BTP
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
      assets: ['iam-technology.svg', 'iam-technology-mark.svg', 'iam-invoicer.svg', 'iam-mails.svg'],
      title: 'IAM Technology — Solutions informatiques, domotique, sécurité et logiciels | Ouagadougou',
      description: "IAM TECHNOLOGY accompagne votre entreprise vers l'excellence technologique : solutions informatiques, domotique, sécurité et surveillance, logiciels IAM INVOICER et IAM MAILS. Ouagadougou, depuis 2013.",
      ogTitle: 'IAM Technology — Transformez votre vision digitale en réalité',
      icon: 'iam-technology-mark.svg'
    }
const out = V.out
rmSync(out, { recursive: true, force: true })
mkdirSync(`${out}/assets`, { recursive: true })
for (const f of V.assets) cpSync(`assets/marques/${f}`, `${out}/assets/${f}`)
if (MAILS) cpSync('site-mails/captures', `${out}/assets/captures`, { recursive: true })
if (BTP) cpSync('site-btp/captures', `${out}/assets/captures`, { recursive: true })

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
writeFileSync(`${out}/index.html`, html.replace(/\r\n?/g, '\n'))
console.log(`Site construit dans ${out}`)
