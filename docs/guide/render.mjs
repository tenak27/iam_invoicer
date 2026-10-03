import { createRequire } from 'node:module'
const { chromium } = createRequire(process.cwd() + '/package.json')('playwright')
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = process.argv[2]
const out = process.argv[3]
copyFileSync(join(process.cwd(), 'resources/logo.svg'), join(dir, 'logo.svg')) // logo à côté du guide
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()
await page.goto(pathToFileURL(join(dir, 'guide.html')).href, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.pdf({
  path: out,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: '<div style="width:100%;font-size:7.5pt;color:#5d6475;padding:0 16mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial"><span>IAM INVOICER 0.4.0 — Guide d\'installation</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'
})
await browser.close()
console.log('PDF : ' + out)
