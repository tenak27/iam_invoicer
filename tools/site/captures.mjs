// Captures d'écran du site de présentation, prises sur un serveur de démonstration.
// Usage : node tools/site/captures.mjs http://127.0.0.1:8080 [identifiant] [mot-de-passe]
import { chromium } from 'playwright'

const base = (process.argv[2] ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const username = process.argv[3] ?? 'admin'
const password = process.argv[4] ?? 'secret123'
const dir = 'site/assets/captures'
// Masque les éléments passagers (notifications, bandeau d'évaluation)
const CLEAN = '.toast, .toaster, .licence-bar, .offline-bar { display: none !important; }'

const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' })
async function session(viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce', deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const app = (await (await fetch(base + '/app/')).text()).includes('<div id="root"') ? '/app/' : '/'
  await page.goto(base + app)
  await page.getByLabel("Nom d'utilisateur").fill(username)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: /Se connecter/ }).click()
  await page.locator('.content').waitFor()
  await page.addStyleTag({ content: CLEAN })
  const go = async (route, ready) => {
    await page.goto(`${base}${app}#${route}`)
    await page.addStyleTag({ content: CLEAN })
    await page.locator(ready).first().waitFor()
    await page.waitForTimeout(1200)
  }
  return { page, go }
}

const desk = await session({ width: 1440, height: 900 })
await desk.go('/', '.kpi-tile')
await desk.page.screenshot({ path: `${dir}/tableau-de-bord.png` })
await desk.go('/docs/FAC', '.kpi-strip')
await desk.page.screenshot({ path: `${dir}/factures.png` })
await desk.go('/compta/bilan', '.bs-total')
await desk.page.screenshot({ path: `${dir}/bilan.png` })
await desk.go('/caisse', '.content')
const tiles = desk.page.locator('.pos-tile')
for (let i = 0; i < Math.min(3, await tiles.count()); i++) await tiles.nth(i).click()
await desk.page.waitForTimeout(500)
await desk.page.screenshot({ path: `${dir}/caisse.png` })

const phone = await session({ width: 390, height: 844 }, true)
await phone.go('/', '.kpi-tile')
await phone.page.screenshot({ path: `${dir}/mobile.png` })
await browser.close()
console.log('Captures enregistrées dans ' + dir)
