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
  saveText(name: string, content: string): Promise<Result>
  pickImage(): Promise<Result<string | null>>
  backup(): Promise<Result>
  restore(): Promise<Result>
}

interface Window {
  erp: ErpBridge
}
