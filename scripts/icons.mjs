// Génère les icônes de l'application à partir de resources/logo-mark.svg :
//   resources/icon.png (1024 px, utilisée par electron-builder pour Windows et macOS)
//   resources/logo.svg (logo horizontal autonome)
//   src/renderer/public/ (favicon, icônes web)
//   assets/ (sources de @capacitor/assets pour iOS et Android)
// Usage : node scripts/icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const mark = readFileSync('resources/logo-mark.svg')
const png = (svg, size) => sharp(Buffer.isBuffer(svg) ? svg : Buffer.from(svg), { density: 300 }).resize(size, size).png().toBuffer()

// Logo horizontal : on intègre le pictogramme pour que le fichier soit autonome.
const inner = mark.toString().replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
const wordmark = readFileSync('resources/logo.svg', 'utf8')
  .replace(/<image href="logo-mark.svg"[^>]*\/>|<svg x="0" y="0" width="400" height="400" viewBox="0 0 1024 1024">[\s\S]*?<\/svg><!--mark-->/, `<svg x="0" y="0" width="400" height="400" viewBox="0 0 1024 1024">${inner}</svg><!--mark-->`)
writeFileSync('resources/logo.svg', wordmark)

writeFileSync('resources/icon.png', await png(mark, 1024))

mkdirSync('src/renderer/public', { recursive: true })
writeFileSync('src/renderer/public/favicon.svg', mark)
writeFileSync('src/renderer/public/icon-192.png', await png(mark, 192))
writeFileSync('src/renderer/public/icon-512.png', await png(mark, 512))
writeFileSync('src/renderer/public/apple-touch-icon.png', await png(mark, 180))

// Android : icône adaptative = pictogramme sans le fond arrondi + fond uni.
mkdirSync('assets', { recursive: true })
const foreground = mark.toString()
  .replace(/<rect width="1024" height="1024" rx="228" fill="url\(#bg\)"\/>/, '')
  .replace('viewBox="0 0 1024 1024"', 'viewBox="-256 -256 1536 1536"')
const square = mark.toString().replace('rx="228"', 'rx="0"')
writeFileSync('assets/icon-only.png', await png(square, 1024))
writeFileSync('assets/icon-foreground.png', await png(foreground, 1024))
writeFileSync('assets/icon-background.png', await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#0b4f8a' } }).png().toBuffer())
const splash = (bg) => sharp({ create: { width: 2732, height: 2732, channels: 4, background: bg } })
  .composite([{ input: Buffer.from(mark.toString().replace('width="1024" height="1024"', 'width="640" height="640"')), gravity: 'center' }])
  .png().toBuffer()
writeFileSync('assets/splash.png', await splash('#0b4f8a'))
writeFileSync('assets/splash-dark.png', await splash('#0a1a2b'))
console.log('Icônes générées.')
