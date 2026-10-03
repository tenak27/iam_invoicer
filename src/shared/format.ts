// Formatage des montants (FCFA, sans décimales) et des dates.

export function formatNumber(n: number, decimals = 0): string {
  const fixed = Math.abs(n).toFixed(decimals)
  const [int, dec] = fixed.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (n < 0 ? '-' : '') + grouped + (dec ? ',' + dec : '')
}

export function formatMoney(n: number, currency = 'FCFA'): string {
  return `${formatNumber(Math.round(n))} ${currency}`
}

export function formatQty(n: number): string {
  return Number.isInteger(n) ? formatNumber(n) : formatNumber(n, 2)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf']
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt']

function below100(n: number): string {
  if (n < 20) return UNITS[n]
  const t = Math.floor(n / 10)
  let u = n % 10
  if (t === 7 || t === 9) u += 10
  if (u === 0) return t === 8 ? 'quatre-vingts' : TENS[t]
  const sep = (u === 1 || u === 11) && t !== 8 && t !== 9 ? ' et ' : '-'
  return TENS[t] + sep + UNITS[u]
}

function below1000(n: number): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  if (h === 0) return below100(r)
  const head = h === 1 ? 'cent' : UNITS[h] + (r === 0 ? ' cents' : ' cent')
  return r === 0 ? head : head + ' ' + below100(r)
}

/** Nombre entier en toutes lettres (orthographe traditionnelle). */
export function numberToFrenchWords(value: number): string {
  let n = Math.round(Math.abs(value))
  if (n === 0) return 'zéro'
  const parts: string[] = []
  const scales: [number, string, string][] = [
    [1e9, 'milliard', 'milliards'],
    [1e6, 'million', 'millions']
  ]
  for (const [size, one, many] of scales) {
    const q = Math.floor(n / size)
    if (q > 0) {
      parts.push(`${below1000Big(q)} ${q > 1 ? many : one}`)
      n %= size
    }
  }
  const thousands = Math.floor(n / 1000)
  if (thousands > 0) {
    // « cent » et « vingt » ne prennent pas de s devant « mille »
    parts.push(thousands === 1 ? 'mille' : below1000(thousands).replace(/(cent|vingt)s$/, '$1') + ' mille')
    n %= 1000
  }
  if (n > 0) parts.push(below1000(n))
  return (value < 0 ? 'moins ' : '') + parts.join(' ')
}

function below1000Big(n: number): string {
  return n < 1000 ? below1000(n) : numberToFrenchWords(n)
}

export function amountInWords(n: number, currency = 'francs CFA'): string {
  const words = numberToFrenchWords(n)
  return words.charAt(0).toUpperCase() + words.slice(1) + ' ' + currency
}
