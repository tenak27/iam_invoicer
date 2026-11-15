// Appels sortants paramétrés par une société (passerelle SMS, serveur SMTP, SECeF).
// Sur un serveur qui héberge plusieurs sociétés, ces adresses sont choisies par des tiers :
// elles ne doivent pas viser le réseau interne du serveur (base de données, console, autres sites).

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { fail } from './services/context'

let restricted = false

/** Activé par le serveur multi-sociétés ; sans effet sur un poste ou un serveur d'entreprise. */
export function restrictOutbound(on: boolean) {
  restricted = on
}
export const outboundRestricted = () => restricted

/** Adresse IPv4 portée par une adresse IPv6 (::ffff:a.b.c.d, ::ffff:7f00:1, ::a.b.c.d, 64:ff9b::/96…), sinon null. */
function embeddedIPv4(v: string): string | null {
  let s = v
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (dotted) {
    if (isIP(dotted[1]) !== 4) return null
    const [a, b, c, d] = dotted[1].split('.').map(Number)
    s = s.slice(0, -dotted[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  if (fill < 0) return null
  const g = [...head, ...Array(fill).fill('0'), ...tail].map((x) => parseInt(x || '0', 16))
  if (g.length !== 8 || g.some((x) => !(x >= 0 && x <= 0xffff))) return null
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0)
  const mapped = (zero(0, 5) && (g[5] === 0xffff || g[5] === 0)) || (zero(0, 4) && g[4] === 0xffff && g[5] === 0) || (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6))
  if (!mapped || (zero(0, 7) && g[7] <= 1)) return null
  return [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff].join('.')
}

export function isInternalAddress(ip: string): boolean {
  let v = ip.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  if (isIP(v) === 6) v = embeddedIPv4(v) ?? v
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  return v === '::1' || v === '::' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v)
}

/** Refuse un hôte qui désigne (directement ou par son nom) une adresse interne. */
export async function assertPublicHost(hostOrUrl: string, what: string): Promise<void> {
  if (!restricted) return
  let host = String(hostOrUrl ?? '').trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
    let u: URL
    try {
      u = new URL(host)
    } catch {
      fail(`${what} : adresse invalide.`)
    }
    if (!/^https?:$/.test(u.protocol)) fail(`${what} : seules les adresses http(s) sont acceptées.`)
    host = u.hostname
  }
  host = host.replace(/^\[|\]$/g, '')
  if (!host) fail(`${what} : adresse invalide.`)
  let addresses: string[]
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address)
  } catch {
    fail(`${what} : nom de serveur introuvable (${host}).`)
  }
  if (!addresses.length || addresses.some(isInternalAddress)) fail(`${what} : cette adresse désigne un réseau interne et n'est pas acceptée sur ce serveur.`)
}
