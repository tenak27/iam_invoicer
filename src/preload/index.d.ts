type Result<T = any> = { ok: true; data: T } | { ok: false; error: string }

type DataMode = 'local' | 'server' | 'remote'

interface AppStatus {
  dbReady: boolean
  dbError: string | null
  dbMode: DataMode
  /** Adresse du serveur IAM INVOICER (mode « remote », web et mobile). */
  serverUrl: string | null
  version: string
  platform: string
  user: any
  /** Démarrage sans réseau, sur les données gardées par l'appareil. */
  offline?: boolean
}

interface EnterpriseInfo {
  available: boolean
  serve?: boolean
  listening?: boolean
  port?: number
  addresses?: string[]
  error?: string | null
  cloudUrl?: string
  hasCloudKey?: boolean
  cloudMinutes?: number
  mirror?: { enabled: boolean; running: boolean; last: string | null; lastError: string | null; rows: number; bytes: number }
}

interface SyncState {
  reachable: boolean
  pending: number
  failed: { opId: string; name: string; at: string; error: string }[]
  lastSync: string | null
  lastPrefetch: string | null
  localBytes: number
  needsLogin: boolean
}

/** Pont vers les données : Electron (IPC) sur ordinateur, HTTP sur le web et le mobile. */
interface ErpBridge {
  kind: 'desktop' | 'web' | 'mobile'
  call(name: string, args?: unknown): Promise<Result>
  status(): Promise<AppStatus>
  /** Version plus récente disponible pour cet appareil, sinon null. */
  checkUpdate?(): Promise<{ current: string; latest: string; url: string | null; reload?: boolean } | null>
  /** Web et mobile : nom et logo de la société servie par le serveur (avant connexion). */
  brand?(url?: string): Promise<{ name: string; logo: string; color: string; city: string } | null>
  /** Web et mobile : sociétés récemment ouvertes sur cet appareil. */
  recent?(): { url: string; name: string; at: string }[]
  /** Ouvre une adresse https dans le navigateur du système. */
  openExternal?(url: string): Promise<unknown>
  login(username: string, password: string): Promise<Result>
  setup(input: unknown): Promise<Result>
  logout(): Promise<Result>
  getDbConfig(): Promise<any>
  testDbConfig(cfg: unknown): Promise<Result>
  saveDbConfig(cfg: unknown): Promise<void>
  /** `duplicata` : réédition d'un document déjà établi (tampon et mention DUPLICATA). */
  pdf(id: number, action: 'open' | 'save' | 'print', format?: 'a4' | 'ticket', opts?: { duplicata?: boolean }): Promise<Result>
  /** Ordinateur : PDF exact du document (base64) pour l'aperçu avant impression. */
  pdfPreview?(id: number, format?: 'a4' | 'ticket', opts?: { duplicata?: boolean }): Promise<Result<string>>
  saveText(name: string, content: string): Promise<Result>
  /** Fichier binaire (ex. classeur .xlsx), contenu en base64. */
  saveBinary(name: string, base64: string): Promise<Result>
  /** Imprime un HTML complet (PDF sur ordinateur, fenêtre d'impression sur le web). */
  printHtml(html: string, filename: string): Promise<Result>
  /** Envoie un document par e-mail (PDF joint sur ordinateur, HTML depuis le web/mobile). */
  sendDocumentEmail(input: { documentId: number; to: string; subject: string; body: string }): Promise<Result>
  pickImage(): Promise<Result<string | null>>
  backup(): Promise<Result>
  restore(): Promise<Result>
  /** Ordinateur qui détient la base : partage sur le réseau local et copie en ligne. */
  enterprise?: {
    get(): Promise<Result<EnterpriseInfo>>
    save(input: { serve?: boolean; port?: number; cloudUrl?: string; cloudKey?: string; cloudMinutes?: number }): Promise<Result<EnterpriseInfo>>
    push(): Promise<Result>
  }
  /** Ordinateur, base de ce poste : sauvegardes automatiques. */
  backupAuto?: {
    get(): Promise<Result<{ enabled: boolean; dir: string; keep: number; last: string | null; lastError: string | null; available: boolean; files: { name: string; size: number; date: string }[] }>>
    set(input: { enabled?: boolean; keep?: number }): Promise<Result>
    chooseDir(): Promise<Result<string | null>>
    now(): Promise<Result<string | null>>
  }
  /** Mode hors ligne : web, mobile, et ordinateur relié à un serveur en ligne. */
  offline?: {
    pending(): number
    failed(): { opId: string; name: string; at: string; error: string }[]
    sync(): Promise<{ sent: number; failed: number }>
    clearFailed(): void
    /** Ordinateur : le serveur ne répond pas (même si le réseau local fonctionne). */
    serverDown?(): boolean
    /** Ordinateur : état détaillé de la base locale de travail. */
    state?(): SyncState | null
    prefetch?(): Promise<Result<number>>
    clearCache?(): Promise<boolean>
  }
}

interface Window {
  erp: ErpBridge
}
