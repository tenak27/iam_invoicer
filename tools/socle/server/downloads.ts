// Installateurs proposés en téléchargement (/telechargements/) : classement par plateforme,
// architecture et version, empreinte SHA-256 (calculée une fois par fichier), et envoi des
// fichiers avec reprise (en-tête Range), utile sur les connexions mobiles qui coupent.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join } from 'node:path'

export type Platform = 'windows' | 'macos' | 'android' | 'ios' | 'linux'
export type Kind = 'installer' | 'portable' | 'apk' | 'aab' | 'ipa' | 'package'

export interface DownloadFile {
  name: string
  platform: Platform
  kind: Kind
  arch: 'arm64' | 'x64' | 'universal' | null
  version: string | null
  /** .ipa : signé (installable directement) ou non signé. */
  signed: boolean | null
  size: number
  updated: string
  sha256: string
  url: string
}

const ACCEPTED = /\.(exe|msi|zip|dmg|pkg|apk|aab|ipa|appimage|deb)$/i

export function classify(name: string): Pick<DownloadFile, 'platform' | 'kind' | 'arch' | 'version' | 'signed'> | null {
  if (!ACCEPTED.test(name)) return null
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  const lower = name.toLowerCase()
  let platform: Platform
  if (ext === 'ipa') platform = 'ios'
  else if (ext === 'apk' || ext === 'aab') platform = 'android'
  else if (ext === 'dmg' || ext === 'pkg' || (ext === 'zip' && /mac|darwin|osx/.test(lower))) platform = 'macos'
  else if (ext === 'appimage' || ext === 'deb') platform = 'linux'
  else platform = 'windows'
  const kind: Kind = ext === 'zip' ? 'portable' : ext === 'apk' ? 'apk' : ext === 'aab' ? 'aab' : ext === 'ipa' ? 'ipa' : ext === 'deb' || ext === 'appimage' ? 'package' : 'installer'
  const arch = /universal/.test(lower) ? 'universal' : /arm64|aarch64|apple-?silicon/.test(lower) ? 'arm64' : /x64|x86_64|amd64|intel/.test(lower) ? 'x64' : null
  const version = /(\d+\.\d+\.\d+)/.exec(name)?.[1] ?? null
  const signed = kind === 'ipa' ? !/unsigned|non-?sign/.test(lower) : null
  return { platform, kind, arch, version, signed }
}

/** > 0 si a est plus récente que b (1.10.0 > 1.9.3). */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const parts = (v: string | null | undefined) => String(v ?? '0.0.0').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

// Empreintes : clé = chemin + taille + date, pour ne relire un fichier que s'il a changé
const hashes = new Map<string, Promise<string>>()
function sha256(path: string, key: string): Promise<string> {
  let p = hashes.get(key)
  if (!p) {
    p = new Promise<string>((ok, ko) => {
      const h = createHash('sha256')
      createReadStream(path).on('data', (c) => h.update(c)).on('error', ko).on('end', () => ok(h.digest('hex')))
    })
    p.catch(() => hashes.delete(key))
    hashes.set(key, p)
  }
  return p
}

export async function listDownloads(dir: string | undefined): Promise<DownloadFile[]> {
  if (!dir || !existsSync(dir)) return []
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (e) {
    console.warn(`Dossier des téléchargements illisible (${dir}) : ${(e as Error).message}`)
    return []
  }
  const out: DownloadFile[] = []
  for (const name of names) {
    const c = classify(name)
    if (!c) continue
    const path = join(dir, name)
    const st = statSync(path)
    if (!st.isFile()) continue
    out.push({ name, ...c, size: st.size, updated: st.mtime.toISOString().slice(0, 10), sha256: await sha256(path, `${path}|${st.size}|${st.mtimeMs}`), url: '/telechargements/' + encodeURIComponent(name) })
  }
  // Version la plus récente d'abord, puis le fichier le plus récent
  return out.sort((a, b) => compareVersions(b.version, a.version) || b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name))
}

const TYPES: Record<string, string> = {
  apk: 'application/vnd.android.package-archive',
  ipa: 'application/octet-stream',
  exe: 'application/vnd.microsoft.portable-executable',
  msi: 'application/x-msi',
  dmg: 'application/x-apple-diskimage',
  zip: 'application/zip',
  appimage: 'application/octet-stream',
  deb: 'application/vnd.debian.binary-package'
}

/** Envoie /telechargements/<fichier> (nom simple seulement), avec reprise. Faux si absent. */
export function serveDownload(req: IncomingMessage, res: ServerResponse, dir: string | undefined, path: string): boolean {
  if (!dir) return false
  let name: string
  try {
    name = decodeURIComponent(path.slice('/telechargements/'.length))
  } catch {
    return false
  }
  if (!name || name !== basename(name) || name.startsWith('.') || !classify(name)) return false
  const file = join(dir, name)
  let st
  try {
    st = statSync(file)
  } catch {
    return false
  }
  if (!st.isFile()) return false
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  const headers: Record<string, string | number> = {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
    'Last-Modified': st.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff'
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2])
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1
    start = Math.max(0, start)
    end = Math.min(end, st.size - 1)
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` })
      res.end()
      return true
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 })
    if (req.method === 'HEAD') res.end()
    else createReadStream(file, { start, end }).pipe(res)
    return true
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size })
  if (req.method === 'HEAD') res.end()
  else createReadStream(file).pipe(res)
  return true
}
