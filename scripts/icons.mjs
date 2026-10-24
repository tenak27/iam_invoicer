// Génère les icônes de l'application à partir de l'icône dessinée pour IAM INVOICER
// (assets/marques/iam-invoicer-icone.png : 512 px, carré coloré arrondi et son ombre, sur fond blanc) :
//   resources/icon.png   (1024 px, fond transparent : electron-builder en tire Windows et macOS)
//   src/renderer/public/ (favicon et icônes web ; icône plein cadre pour l'écran d'accueil d'iOS)
//   assets/              (sources de @capacitor/assets pour iOS et Android)
// Deux versions de l'icône dessinée :
//   détourée     le fond blanc retiré, l'ombre et le dessin blanc intérieur conservés (bureau, web,
//                icône adaptative d'Android posée sur fond blanc dans la zone sûre) ;
//   plein cadre  le carré coloré seul, coins comblés (iOS l'arrondit lui-même et refuse la transparence).
// Les écrans de démarrage gardent le logo complet (assets/marques/iam-invoicer.svg).
// Usage : node scripts/icons.mjs (puis npm run icons pour les jeux d'icônes iOS et Android)
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

copyFileSync('assets/marques/iam-invoicer-mark.svg', 'resources/logo-mark.svg')
copyFileSync('assets/marques/iam-invoicer.svg', 'resources/logo.svg')
const markSvg = readFileSync('assets/marques/iam-invoicer-mark.svg', 'utf8')
const logoSvg = readFileSync('assets/marques/iam-invoicer.svg', 'utf8')
const source = await sharp('assets/marques/iam-invoicer-icone.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const icone = { data: source.data, w: source.info.width, h: source.info.height }

/** Fond blanc relié aux bords de l'image retiré (le dessin blanc enfermé dans le carré n'est pas touché). */
function detouree({ data, w, h }) {
  const out = Buffer.from(data)
  const minc = (i) => Math.min(data[i], data[i + 1], data[i + 2])
  const bg = new Uint8Array(w * h)
  const stack = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const p = y * w + x
    if (bg[p] || minc(p * 4) < 238) return
    bg[p] = 1
    stack.push(p)
  }
  for (let x = 0; x < w; x++) push(x, 0), push(x, h - 1)
  for (let y = 0; y < h; y++) push(0, y), push(w - 1, y)
  while (stack.length) {
    const p = stack.pop()
    const x = p % w
    const y = (p - x) / w
    push(x + 1, y), push(x - 1, y), push(x, y + 1), push(x, y - 1)
  }
  for (let p = 0; p < w * h; p++) {
    if (bg[p]) {
      out[p * 4 + 3] = 0
      continue
    }
    // Bord adouci : mélange de blanc et de la couleur voisine, retrouvée deux pixels vers l'intérieur
    const x = p % w
    const y = (p - x) / w
    const toward = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => bg[(y + dy) * w + (x + dx)] === 1)
    if (!toward) continue
    const r = (Math.min(h - 1, Math.max(0, y - toward[1] * 2)) * w + Math.min(w - 1, Math.max(0, x - toward[0] * 2))) * 4
    let a = 0
    let n = 0
    for (let c = 0; c < 3; c++) {
      if (255 - data[r + c] < 12) continue
      a += (255 - data[p * 4 + c]) / (255 - data[r + c])
      n++
    }
    out[p * 4 + 3] = Math.round((n ? Math.max(0, Math.min(1, a / n)) : 1) * 255)
    for (let c = 0; c < 3; c++) out[p * 4 + c] = data[r + c]
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}

/** Cadre du carré principal : bords gauche et haut au premier pixel coloré ; bord droit trouvé en
 *  venant de la droite (fond blanc, puis l'ombre claire, puis le carré plus foncé). */
function cadre({ data, w }) {
  const px = (x, y) => (y * w + x) * 4
  const minc = (x, y) => Math.min(data[px(x, y)], data[px(x, y) + 1], data[px(x, y) + 2])
  const lum = (x, y) => 0.299 * data[px(x, y)] + 0.587 * data[px(x, y) + 1] + 0.114 * data[px(x, y) + 2]
  const mid = Math.round(w / 2)
  let left = 0
  while (left < mid && minc(left, mid) >= 200) left++
  let top = 0
  while (top < mid && minc(mid, top) >= 200) top++
  const y = Math.round(top + (w - 2 * top) * 0.7)
  let x = w - 1
  while (x > mid && minc(x, y) >= 238) x--
  const ombre = lum(x - 3, y)
  while (x > mid && lum(x, y) > ombre - 25) x--
  return { left, top, size: x - left + 1 }
}

/** Le carré coloré seul, en plein cadre (taille × taille), coins comblés par la couleur voisine. */
async function pleinCadre(taille) {
  const { left, top, size } = cadre(icone)
  const inset = Math.round(size * 0.008)
  const crop = { left: left + inset, top: top + inset, width: size - 2 * inset, height: size - 2 * inset }
  const carre = await sharp(icone.data, { raw: { width: icone.w, height: icone.h, channels: 4 } }).extract(crop).png().toBuffer()
  const masque = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${crop.width}" height="${crop.height}"><rect width="${crop.width}" height="${crop.height}" rx="${Math.round(crop.width * 0.23)}" fill="#fff"/></svg>`)
  const arrondi = await sharp(carre).composite([{ input: masque, blend: 'dest-in' }]).png().toBuffer()
  // Couleurs moyennes des coins (le redimensionnement ignore les pixels transparents), étalées en dégradé
  const coins = await sharp(arrondi).resize(3, 3, { fit: 'fill' }).removeAlpha().png().toBuffer()
  const fond = await sharp(coins).resize(crop.width, crop.height, { fit: 'fill', kernel: 'cubic' }).png().toBuffer()
  // sharp redimensionne avant de superposer : superposition d'abord, redimensionnement ensuite
  const complet = await sharp(fond).composite([{ input: arrondi }]).png().toBuffer()
  return sharp(complet).resize(taille, taille, { kernel: 'lanczos3' }).png().toBuffer()
}

const detour = await detouree(icone)
const enTaille = (size) => sharp(detour).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer()
/** Fond (blanc) de la taille donnée, l'icône détourée centrée à la largeur indiquée. */
const surFond = async (size, inner, background) =>
  sharp({ create: { width: size, height: size, channels: 4, background } }).composite([{ input: await enTaille(inner), gravity: 'center' }]).png().toBuffer()

// Bureau (Windows, macOS) : icône détourée, sur fond transparent
writeFileSync('resources/icon.png', await enTaille(1024))

// Web : icônes détourées ; écran d'accueil d'iOS (il arrondit et refuse la transparence) : plein cadre
mkdirSync('src/renderer/public', { recursive: true })
writeFileSync('src/renderer/public/favicon.png', await enTaille(64))
writeFileSync('src/renderer/public/icon-192.png', await enTaille(192))
writeFileSync('src/renderer/public/icon-512.png', await enTaille(512))
writeFileSync('src/renderer/public/apple-touch-icon.png', await pleinCadre(180))

// iOS et Android (sources de @capacitor/assets) : iOS en plein cadre ; icône adaptative d'Android :
// l'icône détourée dans la zone sûre (elle reste entière quel que soit le masque du téléphone), fond blanc
mkdirSync('assets', { recursive: true })
writeFileSync('assets/icon-only.png', await pleinCadre(1024))
writeFileSync('assets/icon-foreground.png', await surFond(1024, 600, { r: 0, g: 0, b: 0, alpha: 0 }))
writeFileSync('assets/icon-background.png', await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#ffffff' } }).png().toBuffer())
// Écrans de démarrage : logo complet sur fond blanc ; en mode sombre, le pictogramme seul
const splash = async (bg, svg, width) => sharp({ create: { width: 2732, height: 2732, channels: 4, background: bg } })
  .composite([{ input: await sharp(Buffer.from(svg), { density: 400 }).resize(width).png().toBuffer(), gravity: 'center' }])
  .png().toBuffer()
writeFileSync('assets/splash.png', await splash('#ffffff', logoSvg, 1100))
writeFileSync('assets/splash-dark.png', await splash('#0a1a2b', markSvg, 560))
console.log('Icônes générées.')
