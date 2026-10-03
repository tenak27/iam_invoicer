// Installateurs proposés sur le site (/telechargements/) : classement par plateforme,
// architecture et version, empreinte SHA-256 (calculée une fois par fichier), et
// manifeste d'installation iPhone (itms-services) pour les .ipa signés ad hoc / entreprise.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type Platform = 'windows' | 'macos' | 'android' | 'ios' | 'linux'
export type Kind = 'installer' | 'portable' | 'apk' | 'aab' | 'ipa' | 'package'

export interface DownloadFile {
  name: string
  platform: Platform
  kind: Kind
  arch: 'arm64' | 'x64' | 'universal' | null
  version: string | null
  /** .ipa : signé (installable directement) ou non signé (à signer avec Sideloadly, AltStore…). */
  signed: boolean | null
  size: number
  updated: string
  sha256: string
  url: string
}

const ACCEPTED = /\.(exe|msi|zip|dmg|pkg|apk|aab|ipa|appimage|deb)$/i
export const IOS_BUNDLE_ID = 'com.iamtechnology.invoicer'

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

const cmpVersion = (a: string | null, b: string | null) => {
  const pa = (a ?? '0.0.0').split('.').map(Number), pb = (b ?? '0.0.0').split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i]
  return 0
}

// Empreintes : clé = nom + taille + date, pour ne relire un fichier que s'il a changé.
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
  const out: DownloadFile[] = []
  for (const name of readdirSync(dir)) {
    const c = classify(name)
    if (!c) continue
    const path = join(dir, name)
    const st = statSync(path)
    if (!st.isFile()) continue
    out.push({ name, ...c, size: st.size, updated: st.mtime.toISOString().slice(0, 10), sha256: await sha256(path, `${path}|${st.size}|${st.mtimeMs}`), url: '/telechargements/' + encodeURIComponent(name) })
  }
  // Version la plus récente d'abord, puis les fichiers les plus récents
  return out.sort((a, b) => cmpVersion(a.version, b.version) || b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name))
}

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)

/** Manifeste lu par iOS (lien itms-services://) pour installer un .ipa signé, en HTTPS uniquement. */
export function iosManifest(origin: string, file: DownloadFile, fallbackVersion: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>items</key><array><dict>
<key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>${xml(origin + file.url)}</string></dict></array>
<key>metadata</key><dict>
<key>bundle-identifier</key><string>${IOS_BUNDLE_ID}</string>
<key>bundle-version</key><string>${xml(file.version ?? fallbackVersion)}</string>
<key>kind</key><string>software</string>
<key>title</key><string>IAM INVOICER</string>
</dict></dict></array></dict></plist>
`
}
