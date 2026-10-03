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
  login(username: string, password: string): Promise<Result>
  setup(input: unknown): Promise<Result>
  logout(): Promise<Result>
  getDbConfig(): Promise<any>
  testDbConfig(cfg: unknown): Promise<Result>
  saveDbConfig(cfg: unknown): Promise<void>
  pdf(id: number, action: 'open' | 'save' | 'print', format?: 'a4' | 'ticket'): Promise<Result>
  /** Ordinateur : PDF exact du document (base64) pour l'aperçu avant impression. */
  pdfPreview?(id: number, format?: 'a4' | 'ticket'): Promise<Result<string>>
  saveText(name: string, content: string): Promise<Result>
  /** Imprime un HTML complet (PDF sur ordinateur, fenêtre d'impression sur le web). */
  printHtml(html: string, filename: string): Promise<Result>
  /** Envoie un document par e-mail (PDF joint sur ordinateur, HTML depuis le web/mobile). */
  sendDocumentEmail(input: { documentId: number; to: string; subject: string; body: string }): Promise<Result>
  pickImage(): Promise<Result<string | null>>
  backup(): Promise<Result>
  restore(): Promise<Result>
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
