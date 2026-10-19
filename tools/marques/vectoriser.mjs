// Vectorise un logo IAM sur fond blanc ou transparent (noir, bleu, bleu clair ; détails blancs dans le
// cartouche) en SVG à fond transparent, plus le pictogramme seul (cartouche) au format carré.
// Usage : node tools/marques/vectoriser.mjs <logo.png> <sortie sans extension> "<x y côté>" "<titre>"
//   (x y côté : zone carrée du pictogramme, en pixels de l'image d'origine). Outil ponctuel : npm i --no-save potrace@2
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import potrace from 'potrace'

const req = createRequire(import.meta.url)
const { chromium } = req('playwright')
const [src, name, markBox, title] = process.argv.slice(2)

const b = await chromium.launch({ channel: 'msedge' })
const page = await b.newPage()
await page.setContent('<canvas id=c></canvas>')
const masks = await page.evaluate(async (data) => {
  const img = new Image()
  await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + data })
  // Tracé plus fin : image agrandie 3 fois (lissage du navigateur) avant le seuillage
  const S = 3, W = img.width * S, H = img.height * S
  const c = document.getElementById('c'); c.width = W; c.height = H
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, W, H)
  const px = x.getImageData(0, 0, W, H).data
  const near = (i, r, g, bl, tol) => Math.abs(px[i] - r) < tol && Math.abs(px[i + 1] - g) < tol && Math.abs(px[i + 2] - bl) < tol
  const black = new Uint8Array(W * H), blue = new Uint8Array(W * H), light = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) {
    const i = p * 4
    if (px[i + 3] < 90) continue // fond transparent
    const lum = (px[i] + px[i + 1] + px[i + 2]) / 3
    if (lum < 110 && Math.abs(px[i] - px[i + 2]) < 40) black[p] = 1
    else if (near(i, 60, 84, 165, 60) && px[i + 2] - px[i] > 60) blue[p] = 1
    else if (near(i, 134, 148, 202, 38)) light[p] = 1
  }
  // Détails blancs du cartouche : ce qui n'est pas bleu et n'est pas joignable depuis le bord
  const seen = new Uint8Array(W * H), stack = []
  for (let X = 0; X < W; X++) stack.push(X, (H - 1) * W + X)
  for (let Y = 0; Y < H; Y++) stack.push(Y * W, Y * W + W - 1)
  while (stack.length) {
    const p = stack.pop()
    if (seen[p] || blue[p]) continue
    seen[p] = 1
    const X = p % W, Y = (p / W) | 0
    if (X > 0) stack.push(p - 1); if (X < W - 1) stack.push(p + 1); if (Y > 0) stack.push(p - W); if (Y < H - 1) stack.push(p + W)
  }
  const white = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) if (!blue[p] && !seen[p]) white[p] = 1
  const toPng = (m) => {
    const out = x.createImageData(W, H)
    for (let p = 0; p < W * H; p++) { const v = m[p] ? 0 : 255; out.data.set([v, v, v, 255], p * 4) }
    x.putImageData(out, 0, 0)
    return c.toDataURL('image/png').split(',')[1]
  }
  return { W, H, S, black: toPng(black), blue: toPng(blue), light: toPng(light), white: toPng(white) }
}, readFileSync(src).toString('base64'))

const trace = (layer) =>
  new Promise((resolve, reject) => {
    const file = `${name}-${layer}.png`
    writeFileSync(file, Buffer.from(masks[layer], 'base64'))
    const t = new potrace.Potrace()
    t.setParameters({ turdSize: 30, optTolerance: 0.4, threshold: 128, blackOnWhite: true })
    t.loadImage(file, (err) => (err ? reject(err) : resolve((/ d="([^"]+)"/.exec(t.getPathTag()) ?? [])[1] ?? '')))
  })

const d = {}
for (const l of ['light', 'blue', 'white', 'black']) d[l] = await trace(l)
const S = masks.S
const body = [
  d.light && `<path fill="#8694CA" fill-rule="evenodd" d="${d.light}"/>`,
  d.blue && `<path fill="#3C54A5" fill-rule="evenodd" d="${d.blue}"/>`,
  d.white && `<path fill="#FFFFFF" fill-rule="evenodd" d="${d.white}"/>`,
  d.black && `<path fill="#0A0A0A" fill-rule="evenodd" d="${d.black}"/>`
].filter(Boolean).join('')
const W = masks.W, H = masks.H
writeFileSync(`${name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W / S}" height="${H / S}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`)
const [mx, my, mw] = markBox.split(' ').map((v) => Number(v) * S)
// Pictogramme : uniquement le cartouche (bleu clair, bleu, détails blancs)
const markBody = body.replace(/<path fill="#0A0A0A"[^>]*\/>/, '')
writeFileSync(`${name}-mark.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mx} ${my} ${mw} ${mw}" width="512" height="512" role="img" aria-label="${title}"><title>${title}</title>${markBody}</svg>\n`)
await b.close()
console.log(name, 'tracé', Object.entries(d).map(([k, v]) => `${k}=${v.length}`).join(' '))
