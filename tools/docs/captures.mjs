// Captures d'écran du manuel de formation, prises sur un serveur de démonstration
// (données du parcours de test). Usage :
//   node tools/docs/captures.mjs http://127.0.0.1:8080 [identifiant] [mot-de-passe]
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const base = (process.argv[2] ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const username = process.argv[3] ?? 'admin'
const password = process.argv[4] ?? 'secret123'
const dir = 'docs/formation/captures'
mkdirSync(dir, { recursive: true })
const CLEAN = '.toast, .toaster, .licence-bar { display: none !important; }'

const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', deviceScaleFactor: 1 })
const page = await ctx.newPage()
const app = (await (await fetch(base + '/app/')).text()).includes('id="root"') ? `${base}/app/` : `${base}/`

await page.goto(app)
await page.getByLabel("Nom d'utilisateur").waitFor()
await page.screenshot({ path: `${dir}/connexion.jpg`, type: 'jpeg', quality: 85 })
await page.getByLabel("Nom d'utilisateur").fill(username)
await page.getByLabel('Mot de passe').fill(password)
await page.getByRole('button', { name: /Se connecter/ }).click()
await page.locator('.content').waitFor()

async function shot(name, route, ready, after) {
  await page.goto(`${app}#${route}`)
  await page.addStyleTag({ content: CLEAN })
  await page.locator(ready).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(900)
  if (after) await after()
  await page.screenshot({ path: `${dir}/${name}.jpg`, type: 'jpeg', quality: 85 })
  console.log('✓', name)
}
const click = (sel) => async () => { await page.locator(sel).first().click(); await page.waitForTimeout(700) }

await shot('tableau-de-bord', '/', '.kpi-tile')
await shot('recherche', '/', '.kpi-tile', async () => { await page.keyboard.press('Control+k'); await page.waitForTimeout(500) })
await page.keyboard.press('Escape')
await shot('factures', '/docs/FAC', '.kpi-strip')
await shot('facture-nouvelle', '/docs/FAC/new', '.lines-table')
await shot('facture', '/docs/FAC', '.kpi-strip', click('tr.clickable'))
await shot('clients', '/clients', '.kpi-strip')
await shot('crm', '/crm', '.kanban')
await shot('recurrentes', '/recurrentes', '.page-hero')
await shot('caisse', '/caisse', '.page-hero', async () => { const t = page.locator('.pos-tile'); for (let i = 0; i < 3 && i < await t.count(); i++) await t.nth(i).click(); await page.waitForTimeout(400) })
await shot('caisse-sessions', '/caisse/sessions', '.page-hero')
await shot('articles', '/products', '.kpi-strip')
await shot('stock', '/stock', '.kpi-strip')
await shot('depots', '/stock/depots', '.page-hero')
await shot('inventaire', '/stock/inventory', '.page-hero')
await shot('commandes', '/docs/BC', '.kpi-strip')
await shot('paiements', '/payments', '.kpi-strip')
await shot('journaux', '/compta', '.page-hero')
await shot('balance', '/compta/balance', '.page-hero')
await shot('bilan', '/compta/bilan', '.bs-total')
await shot('declarations', '/declarations', '.page-hero')
await shot('immobilisations', '/immobilisations', '.page-hero')
await shot('tresorerie', '/budget', '.page-hero')
await shot('rh', '/rh', '.page-hero')
await shot('rh-paie', '/rh', '.page-hero', click('[role=tab]:has-text("Paie")'))
await shot('projets', '/projets', '.kpi-strip')
await shot('projet', '/projets', '.project-card', click('.project-card'))
await shot('projet-taches', '/projets', '.project-card', async () => { await page.locator('.project-card').first().click(); await page.waitForTimeout(800); await page.getByRole('tab', { name: /^Tâches/ }).click(); await page.waitForTimeout(600) })
await shot('parametres', '/settings', '.page-hero')
await shot('taxes', '/settings', '.page-hero', click('[role=tab]:has-text("Taxes")'))
await shot('mise-en-page', '/settings', '.page-hero', async () => { await page.getByRole('tab', { name: 'Documents & signature' }).click(); await page.waitForTimeout(500); await page.getByRole('heading', { name: 'Mise en page et impression' }).scrollIntoViewIfNeeded() })
await shot('utilisateurs', '/users', '.kpi-strip')
await shot('roles', '/roles', '.role-matrix')
await shot('import', '/import', '.import-grid')
await shot('licence', '/licence', '.tier-card')
await shot('mon-compte', '/account', '.profile-card')

// Téléphone
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
const m = await phone.newPage()
await m.goto(app)
await m.getByLabel("Nom d'utilisateur").fill(username)
await m.getByLabel('Mot de passe').fill(password)
await m.getByRole('button', { name: /Se connecter/ }).click()
await m.locator('.content').waitFor()
await m.addStyleTag({ content: CLEAN })
await m.waitForTimeout(900)
await m.screenshot({ path: `${dir}/mobile.jpg`, type: 'jpeg', quality: 85 })
await m.goto(`${app}#/docs/FAC`)
await m.addStyleTag({ content: CLEAN })
await m.waitForTimeout(1200)
await m.screenshot({ path: `${dir}/mobile-factures.jpg`, type: 'jpeg', quality: 85 })
await browser.close()
console.log('Captures enregistrées dans ' + dir)
