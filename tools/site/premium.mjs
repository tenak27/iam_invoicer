// Finition commune des sites (tools/site/premium.css et premium.js) et survol réservé à la souris,
// appliqués à la construction : appelé par build.mjs (site d'IAM INVOICER) et build-entreprise.mjs
// (IAM Technology et les sites des logiciels). Le greffon est celui des applications (tools/socle/build).
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import config from '../socle/build/postcss.config.mjs'

const premium = readFileSync(new URL('./premium.css', import.meta.url), 'utf8')
const behaviours = readFileSync(new URL('./premium.js', import.meta.url), 'utf8').replace(/\r\n?/g, '\n')

/** Ajoute la finition à la fin du dernier <style> de l'en-tête et les comportements communs (premium.js)
 *  en fin de page, puis conditionne les survols de chaque <style>. */
export async function finishSite(html) {
  const head = html.indexOf('</head>')
  const last = html.lastIndexOf('</style>', head)
  if (last < 0) throw new Error('Aucun <style> dans l’en-tête du site')
  html = `${html.slice(0, last)}\n${premium}${html.slice(last)}`
  const end = html.lastIndexOf('</body>')
  if (end < 0) throw new Error('Pas de </body> dans le site')
  html = `${html.slice(0, end)}<script>\n${behaviours}</script>\n${html.slice(end)}`
  html = frenchSpacing(html)
  let out = ''
  let at = 0
  for (const m of html.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
    const { css } = await postcss(config.plugins).process(m[1], { from: undefined })
    out += `${html.slice(at, m.index)}<style>${css}</style>`
    at = m.index + m[0].length
  }
  return out + html.slice(at)
}

/** Typographie française dans les textes (jamais dans les scripts ni les styles) : espace insécable
 *  avant « : ; ! ? » et à l'intérieur des guillemets, entre les groupes de chiffres (15 000,
 *  05 14 23 23) et avant les unités, pour qu'aucune ligne ne commence par une ponctuation ou ne
 *  coupe un nombre. */
function frenchSpacing(html) {
  const fix = (text) => text
    .replace(/ ([:;!?»])/g, ' $1')
    .replace(/« /g, '« ')
    .replace(/(\d) (?=\d)/g, '$1 ')
    .replace(/(\d) (FCFA|h|min|km|%|Go|Mo|To|ans|jours|mois)(?![\p{L}\d])/gu, '$1 $2')
  return html
    .split(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>)/)
    .map((part, i) => (i % 2 ? part : part.replace(/>([^<]+)</g, (m, text) => `>${fix(text)}<`)))
    .join('')
}
