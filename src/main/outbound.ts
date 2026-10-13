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

export function isInternalAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^::ffff:/, '')
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
