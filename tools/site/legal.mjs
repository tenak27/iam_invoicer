// Pages légales communes à tous les sites IAM Technology (confidentialité, conditions générales,
// mentions légales, cookies) et au stockage local. Les gabarits sont dans tools/site/legal/ ; ce module
// les écrit dans <site>/legal/ en remplissant {{APP}} {{HOST}} {{ICON}} {{DATE}}, et fournit à la
// finition commune (premium.mjs) les liens de pied de page et le bandeau cookies.
//   writeLegalPages(outDir, { app, host, icon }) — écrit les 4 pages + vendor.js dans <outDir>/legal/.
//   injectLegal(html)                            — ajoute les liens légaux au pied et le bandeau cookies.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('./legal/', import.meta.url))
const PAGES = ['confidentialite', 'conditions', 'mentions-legales', 'cookies']
// Date de dernière mise à jour affichée en tête de chaque page (une seule source).
const DATE = '19 novembre 2026'

/** Écrit les pages légales de ce site dans <outDir>/legal/ (gabarits remplis + vendor.js copié). */
export function writeLegalPages(outDir, { app, host, icon }) {
  if (!app || !host || !icon) throw new Error('writeLegalPages : app, host et icon attendus')
  mkdirSync(`${outDir}/legal`, { recursive: true })
  for (const name of PAGES) {
    const html = readFileSync(`${DIR}${name}.html`, 'utf8')
      .replace(/\r\n?/g, '\n')
      .replaceAll('{{APP}}', app)
      .replaceAll('{{HOST}}', host)
      .replaceAll('{{ICON}}', icon)
      .replaceAll('{{DATE}}', DATE)
    writeFileSync(`${outDir}/legal/${name}.html`, html)
  }
  cpSync(`${DIR}vendor.js`, `${outDir}/legal/vendor.js`)
}

// Liens légaux ajoutés au pied de chaque site, et bandeau cookies honnête (ces sites ne posent aucun
// traceur). Le comportement du bandeau est dans premium.js, son style dans premium.css.
const FOOTER_LINKS =
  '<div class="legal-links">' +
  '<a href="/legal/confidentialite.html">Confidentialité</a>' +
  '<a href="/legal/conditions.html">Conditions générales</a>' +
  '<a href="/legal/mentions-legales.html">Mentions légales</a>' +
  '<a href="/legal/cookies.html">Cookies</a>' +
  '</div>'

const COOKIE_BANNER =
  '<div class="cookie-note" id="cookie-note" role="dialog" aria-label="Information sur les cookies" hidden>' +
  "<p>Ce site n'utilise que les cookies et le stockage nécessaires à son fonctionnement et à vos préférences, sans traceur publicitaire. <a href=\"/legal/cookies.html\">En savoir plus</a></p>" +
  '<button type="button" class="cookie-ok" data-cookie-ok>J’ai compris</button>' +
  '</div>'

/** Ajoute les liens légaux au dernier <footer> et le bandeau cookies en fin de page. */
export function injectLegal(html) {
  const foot = html.lastIndexOf('</footer>')
  if (foot >= 0) html = `${html.slice(0, foot)}${FOOTER_LINKS}${html.slice(foot)}`
  const body = html.lastIndexOf('</body>')
  if (body >= 0) html = `${html.slice(0, body)}${COOKIE_BANNER}${html.slice(body)}`
  return html
}
