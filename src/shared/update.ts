// Mise à jour disponible : comparaison de versions et choix de l'installateur de l'appareil.
// La source est le serveur de la société (page « Télécharger ») ou, pour un poste sans
// serveur, la dernière publication de l'éditeur.

export interface UpdateInfo {
  current: string
  latest: string
  /** Installateur de cet appareil ; null : l'application web se recharge simplement. */
  url: string | null
  /** Application web : la nouvelle version est déjà servie, il suffit de recharger la page. */
  reload?: boolean
}

export interface DownloadFile {
  name: string
  platform: string
  arch: string | null
  legacy?: boolean
  url: string
}

export const RELEASES_API = 'https://api.github.com/repos/tenak27/iam_invoicer/releases/latest'

/** > 0 si a est plus récente que b (1.10.0 > 1.9.3) ; les suffixes sont ignorés. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => String(v ?? '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

/** Installateur correspondant à l'appareil (plateforme, processeur, ancien macOS). */
export function pickDownload<T extends DownloadFile>(files: T[], device: { platform: string; arch?: string; legacy?: boolean }): T | null {
  const platform = { win32: 'windows', darwin: 'macos' }[device.platform] ?? device.platform
  const mine = files.filter((f) => f.platform === platform)
  if (platform !== 'macos') return mine[0] ?? null
  const arch = device.arch === 'arm64' ? 'arm64' : 'x64'
  return mine.find((f) => f.arch === arch && !!f.legacy === !!device.legacy) ?? mine.find((f) => f.arch === arch) ?? null
}

/** Fichiers d'une publication GitHub → même forme que /api/downloads. */
export function releaseFiles(assets: { name: string; browser_download_url: string }[]): DownloadFile[] {
  return (assets ?? []).flatMap((a) => {
    const platform = /\.exe$/i.test(a.name) ? 'windows' : /\.dmg$/i.test(a.name) ? 'macos' : /\.apk$/i.test(a.name) ? 'android' : /\.ipa$/i.test(a.name) ? 'ios' : null
    if (!platform) return []
    return [{ name: a.name, platform, arch: /arm64/.test(a.name) ? 'arm64' : /x64/.test(a.name) ? 'x64' : null, legacy: /macos-ancien/.test(a.name), url: a.browser_download_url }]
  })
}
