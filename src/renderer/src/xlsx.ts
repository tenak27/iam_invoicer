// Lecture d'un classeur Excel (.xlsx) sans dépendance : un .xlsx est une archive zip
// de fichiers XML. On lit la première feuille et on renvoie un tableau de lignes.
// Décompression : DecompressionStream (navigateurs récents, Electron, Android, iOS 16.4+).

type ZipEntry = { name: string; method: number; size: number; offset: number }

function readEntries(buf: ArrayBuffer): ZipEntry[] {
  const v = new DataView(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66_000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error("Ce fichier n'est pas un classeur Excel (.xlsx) valide.")
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const out: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen))
    // Les données commencent après l'en-tête local (dont la longueur des champs peut différer).
    const lNameLen = v.getUint16(local + 26, true)
    const lExtraLen = v.getUint16(local + 28, true)
    out.push({ name, method, size, offset: local + 30 + lNameLen + lExtraLen })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function readText(buf: ArrayBuffer, e: ZipEntry): Promise<string> {
  const data = new Uint8Array(buf, e.offset, e.size)
  if (e.method === 0) return new TextDecoder().decode(data)
  if (e.method !== 8) throw new Error('Compression non prise en charge dans ce classeur.')
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Première feuille d'un classeur .xlsx → lignes de cellules (texte). */
export async function readXlsx(file: Blob): Promise<string[][]> {
  const buf = await file.arrayBuffer()
  const entries = readEntries(buf)
  const get = (name: string) => entries.find((e) => e.name === name)
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')

  // Feuille : la première du classeur, sinon la première trouvée.
  let sheetPath = 'xl/worksheets/sheet1.xml'
  const wb = get('xl/workbook.xml')
  const rels = get('xl/_rels/workbook.xml.rels')
  if (wb && rels) {
    const first = parse(await readText(buf, wb)).getElementsByTagName('sheet')[0]
    const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    const rel = [...parse(await readText(buf, rels)).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid)
    const target = rel?.getAttribute('Target')
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')
  }
  const sheet = get(sheetPath) ?? entries.find((e) => /^xl\/worksheets\/[^/]+\.xml$/.test(e.name))
  if (!sheet) throw new Error('Aucune feuille trouvée dans ce classeur.')

  const sharedEntry = get('xl/sharedStrings.xml')
  const shared = sharedEntry
    ? [...parse(await readText(buf, sharedEntry)).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''))
    : []

  const rows: string[][] = []
  for (const r of parse(await readText(buf, sheet)).getElementsByTagName('row')) {
    const cells: string[] = []
    let next = 0
    for (const c of r.getElementsByTagName('c')) {
      const ref = c.getAttribute('r')
      const idx = ref ? colIndex(ref) : next
      next = idx + 1
      const t = c.getAttribute('t')
      const v = c.getElementsByTagName('v')[0]?.textContent ?? ''
      let text = v
      if (t === 's') text = shared[Number(v)] ?? ''
      else if (t === 'inlineStr') text = [...c.getElementsByTagName('t')].map((x) => x.textContent ?? '').join('')
      else if (t === 'b') text = v === '1' ? 'VRAI' : 'FAUX'
      while (cells.length < idx) cells.push('')
      cells[idx] = text
    }
    rows.push(cells)
  }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''))
}
