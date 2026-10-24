// Fichier CSV pour Excel (séparateur « ; », accents conservés, lisible par Excel en français) :
// cellules, dates et téléphones. Sans React : utilisable partout, tests compris. Base commune des
// applications IAM : source iam-erp/tools/socle, recopiée par sync.mjs ; ne pas modifier ici.

export type Cell = string | number | boolean | null | undefined

export interface ExportColumn<T> {
  label: string
  value: (row: T) => Cell
}

/** Marque UTF-8 en tête du fichier : sans elle, Excel lit mal les accents. */
const BOM = String.fromCharCode(0xfeff)

const cell = (v: Cell) => {
  let s = v == null ? '' : typeof v === 'boolean' ? (v ? 'oui' : 'non') : typeof v === 'number' ? String(v).replace('.', ',') : String(v)
  // Texte commençant comme une formule (=, +, -, @) : Excel l'exécuterait à l'ouverture (nom de client
  // saisi sur la boutique, par exemple) ; l'apostrophe le garde en texte
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+([.,]\d+)?$/.test(s)) s = `'${s}`
  // Numéro fait seulement de chiffres (n° CNAMU, CNSS, compte) : Excel en ferait un nombre, sans les
  // zéros de tête et arrondi au-delà de 15 chiffres ; ="…" le garde tel quel (chiffres seuls : rien à exécuter)
  else if (typeof v === 'string' && /^\d+$/.test(s) && (s.length >= 12 || (s.length > 1 && s[0] === '0'))) s = `="${s}"`
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Tableau → CSV pour Excel. */
export const toCsv = (table: Cell[][]) => BOM + table.map((r) => r.map(cell).join(';')).join('\r\n')

/** Lignes et colonnes → tableau, ligne d'en-tête comprise. */
export const tableOf = <T,>(rows: T[], columns: ExportColumn<T>[]): Cell[][] => [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => c.value(r)))]

const DAY = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const asDate = (v: unknown) => {
  if (v == null || v === '') return null
  // « 2026-10-24 » seul : jour du calendrier, sans décalage horaire
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Date reconnue par Excel : « 24/10/2026 ». */
export const excelDate = (v: unknown): string => {
  const d = asDate(v)
  return d ? DAY.format(d) : ''
}

/** Date et heure reconnues par Excel : « 24/10/2026 07:00 ». */
export const excelDateTime = (v: unknown): string => {
  const d = asDate(v)
  return d ? `${DAY.format(d)} ${TIME.format(d)}` : ''
}

/** Téléphone gardé en texte et lisible : « (+226) 76 99 00 11 », « 76 99 00 11 ». */
export const phoneText = (v: unknown): string => {
  const raw = String(v ?? '').trim()
  const s = raw.replace(/[\s.-]+/g, '')
  const bf = /^(?:\+|00)226(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s)
  if (bf) return `(+226) ${bf.slice(1).join(' ')}`
  const local = /^(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s)
  if (local) return local.slice(1).join(' ')
  return raw
}
