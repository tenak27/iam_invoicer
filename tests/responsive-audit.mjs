// Audit d'adaptation aux écrans : chaque page, sur plusieurs tailles d'écran.
// Détecte le défilement horizontal de la page, les éléments qui sortent de l'écran
// et les cibles tactiles trop petites sur mobile. Capture chaque page.
// Usage : node tests/responsive-audit.mjs http://127.0.0.1:8080 dossier-sortie [identifiant] [mot-de-passe]

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:8080'
// Avec le site de présentation, l'application est servie sous /app/
const root = base.replace(/\/$/, '')
const app = (await (await fetch(root + '/app/')).text()).includes('id="root"') ? root + '/app/' : base
const out = resolve(process.argv[3] ?? 'responsive-out')
const username = process.argv[4] ?? 'admin'
const password = process.argv[5] ?? 'secret123'
mkdirSync(out, { recursive: true })

const SCREENS = [
  { name: 'telephone-360', width: 360, height: 740, mobile: true },
  { name: 'telephone-412', width: 412, height: 915, mobile: true },
  { name: 'tablette-768', width: 768, height: 1024, mobile: true },
  { name: 'tablette-1024', width: 1024, height: 768, mobile: true },
  { name: 'portable-1366', width: 1366, height: 768, mobile: false },
  { name: 'ecran-1920', width: 1920, height: 1080, mobile: false },
  { name: 'ecran-2560', width: 2560, height: 1440, mobile: false }
]

const ROUTES = [
  '/', '/caisse', '/caisse/sessions', '/docs/DEV', '/docs/FAC', '/docs/FAC/new', '/clients', '/crm', '/docs/BC', '/suppliers',
  '/products', '/stock', '/stock/movements', '/stock/inventory', '/stock/depots', '/payments', '/reports',
  '/projets', '/rh', '/immobilisations', '/budget', '/messages', '/messages/modeles',
  '/compta', '/compta/grand-livre', '/compta/balance', '/compta/resultat', '/compta/bilan', '/declarations', '/compta/comptes',
  '/settings', '/users', '/import', '/licence', '/audit', '/account'
]

const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' })
const report = []
for (const s of SCREENS) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, isMobile: s.mobile, hasTouch: s.mobile, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(app)
  await page.getByLabel("Nom d'utilisateur").fill(username)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: /Se connecter/ }).click()
  await page.locator('.content').waitFor()
  for (const route of ROUTES) {
    await page.goto(`${app.replace(/\/$/, '')}/#${route}`)
    await page.waitForTimeout(700)
    const issues = await page.evaluate(({ mobile }) => {
      const vw = document.documentElement.clientWidth
      const found = []
      if (document.documentElement.scrollWidth > vw + 1) found.push(`page plus large que l'écran (${document.documentElement.scrollWidth} > ${vw})`)
      // Éléments qui sortent à droite sans être dans une zone qui défile
      const inScroller = (el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX
          if (o === 'auto' || o === 'scroll' || o === 'hidden') return true
        }
        return false
      }
      const seen = new Set()
      for (const el of document.querySelectorAll('.content *')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.right > vw + 2 && !inScroller(el)) {
          const key = el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName
          if (!seen.has(key)) { seen.add(key); found.push(`déborde : ${key} (${Math.round(r.right)}px)`) }
        }
      }
      if (mobile) {
        const small = [...document.querySelectorAll('.content button, .content a, .content [role=tab], .content select, .content input:not([type=hidden])')]
          .filter((el) => {
            const r = el.getBoundingClientRect()
            return r.width > 0 && r.height > 0 && (r.height < 36 || r.width < 36) && getComputedStyle(el).visibility !== 'hidden' && !el.closest('.chips, .breadcrumbs') && !(el.matches('input[type=checkbox], input[type=radio]') && el.closest('label'))
          })
          .map((el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30))
        if (small.length) found.push(`cibles tactiles < 36 px : ${[...new Set(small)].slice(0, 6).join(' | ')}${small.length > 6 ? ` (+${small.length - 6})` : ''}`)
      }
      return found
    }, { mobile: s.mobile })
    const shot = `${s.name}${route.replace(/[/]/g, '_') || '_accueil'}.png`
    await page.screenshot({ path: join(out, shot) })
    if (issues.length) report.push({ screen: s.name, route, issues, shot })
  }
  await ctx.close()
}
await browser.close()
writeFileSync(join(out, 'rapport.json'), JSON.stringify(report, null, 2))
const byScreen = SCREENS.map((s) => `${s.name} : ${report.filter((r) => r.screen === s.name).length} page(s) à corriger`)
console.log(byScreen.join('\n'))
for (const r of report) console.log(`- [${r.screen}] ${r.route} → ${r.issues.join(' ; ')}`)
