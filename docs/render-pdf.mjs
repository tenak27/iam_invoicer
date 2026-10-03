// Fabrique un PDF A4 à partir d'une page HTML des manuels (Edge ou Chrome installé).
// Usage : node docs/render-pdf.mjs docs/formation/manuel.html docs/IAM-INVOICER-Manuel-de-formation.pdf "Manuel de formation"
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = createRequire(resolve('package.json'))('playwright')
const [src, out, title = 'IAM INVOICER'] = process.argv.slice(2)
if (!src || !out) throw new Error('Usage : node docs/render-pdf.mjs page.html sortie.pdf "Titre"')
const version = JSON.parse((await import('node:fs')).readFileSync('package.json', 'utf8')).version
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' })
const page = await browser.newPage()
await page.goto(pathToFileURL(resolve(src)).href, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.pdf({
  path: out,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="width:100%;font-size:7.5pt;color:#5d6475;padding:0 15mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial"><span>IAM INVOICER ${version} — ${title}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
})
await browser.close()
console.log('PDF : ' + out)
