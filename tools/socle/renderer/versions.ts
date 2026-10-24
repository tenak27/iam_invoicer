// Versions et choix de l'installateur (base commune des applications IAM : source
// iam-erp/tools/socle ; ne pas modifier ici). Sans dépendance : testé à part.

export interface RemoteFile {
  platform: string
  kind: string
  arch: string | null
  version: string | null
  size: number
  url: string
}

/** > 0 si a est plus récente que b (1.10.0 > 1.9.3). */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const parts = (v: string | null | undefined) => String(v ?? '0.0.0').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/** Installateur le plus récent pour cet appareil, parmi ceux proposés par le serveur. */
export function pickFile(files: RemoteFile[], platform: string, arch: string | null): RemoteFile | null {
  const mine = files.filter((f) => f.platform === platform && f.version)
  if (!mine.length) return null
  const newest = mine.reduce((a, b) => (compareVersions(b.version, a.version) > 0 ? b : a)).version
  const same = mine.filter((f) => f.version === newest)
  if (platform === 'macos') return same.find((f) => f.arch === arch) ?? same.find((f) => f.arch === 'universal') ?? same.find((f) => !f.arch) ?? null
  if (platform === 'windows') return same.find((f) => f.kind === 'installer') ?? same[0]
  if (platform === 'android') return same.find((f) => f.kind === 'apk') ?? null
  return same[0]
}

