// Construit le site de présentation : site/ → out/site, icônes Phosphor insérées en SVG.
// Usage : node tools/site/build.mjs
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as Icons from '@phosphor-icons/react'

const out = 'out/site'
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync('site', out, { recursive: true })

let html = readFileSync('site/index.html', 'utf8')
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
writeFileSync(`${out}/index.html`, html)
console.log(`Site construit dans ${out}`)
