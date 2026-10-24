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
  let out = ''
  let at = 0
  for (const m of html.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
    const { css } = await postcss(config.plugins).process(m[1], { from: undefined })
    out += `${html.slice(at, m.index)}<style>${css}</style>`
    at = m.index + m[0].length
  }
  return out + html.slice(at)
}
