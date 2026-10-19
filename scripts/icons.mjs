// Génère les icônes de l'application à partir des logos d'IAM INVOICER (assets/marques/) :
//   resources/logo-mark.svg, resources/logo.svg  (pictogramme et logo complet, copies de référence)
//   resources/icon.png        (1024 px, utilisée par electron-builder pour Windows et macOS)
//   src/renderer/public/      (favicon, icônes web)
//   assets/                   (sources de @capacitor/assets pour iOS et Android)
// Le pictogramme (cartouche bleu) est posé sur un fond blanc : iOS refuse les icônes transparentes.
// Usage : node scripts/icons.mjs (puis npm run icons pour les jeux d'icônes iOS et Android)
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const markSvg = readFileSync('assets/marques/iam-invoicer-mark.svg', 'utf8')
const logoSvg = readFileSync('assets/marques/iam-invoicer.svg', 'utf8')
copyFileSync('assets/marques/iam-invoicer-mark.svg', 'resources/logo-mark.svg')
copyFileSync('assets/marques/iam-invoicer.svg', 'resources/logo.svg')

const render = (svg, size) => sharp(Buffer.from(svg), { density: 400 }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()

/** Icône carrée : fond blanc (arrondi ou non) et pictogramme centré à la proportion donnée. */
async function icon(size, { radius = 0, scale = 0.82, background = '#ffffff' } = {}) {
  const inner = Math.round(size * scale)
  const base = sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${background}"/></svg>`)
  return base.composite([{ input: plate }, { input: await render(markSvg, inner), gravity: 'center' }]).png().toBuffer()
}

// Bureau (Windows, macOS) : carré blanc arrondi
writeFileSync('resources/icon.png', await icon(1024, { radius: 210 }))

// Web : pictogramme seul (transparent) pour l'onglet, icônes pleines pour l'écran d'accueil
mkdirSync('src/renderer/public', { recursive: true })
writeFileSync('src/renderer/public/favicon.svg', markSvg)
writeFileSync('src/renderer/public/icon-192.png', await icon(192, { radius: 40 }))
writeFileSync('src/renderer/public/icon-512.png', await icon(512, { radius: 104 }))
writeFileSync('src/renderer/public/apple-touch-icon.png', await icon(180, { scale: 0.8 }))

// iOS et Android (sources de @capacitor/assets) : icône pleine, et icône adaptative Android
// (pictogramme dans la zone sûre centrale, fond blanc séparé)
mkdirSync('assets', { recursive: true })
writeFileSync('assets/icon-only.png', await icon(1024, { scale: 0.8 }))
writeFileSync('assets/icon-foreground.png', await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await render(markSvg, 600), gravity: 'center' }]).png().toBuffer())
writeFileSync('assets/icon-background.png', await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#ffffff' } }).png().toBuffer())
// Écrans de démarrage : logo complet sur fond blanc ; en mode sombre, le pictogramme seul
const splash = async (bg, svg, width) => sharp({ create: { width: 2732, height: 2732, channels: 4, background: bg } })
  .composite([{ input: await sharp(Buffer.from(svg), { density: 400 }).resize(width).png().toBuffer(), gravity: 'center' }])
  .png().toBuffer()
writeFileSync('assets/splash.png', await splash('#ffffff', logoSvg, 1100))
writeFileSync('assets/splash-dark.png', await splash('#0a1a2b', markSvg, 560))
console.log('Icônes générées.')
