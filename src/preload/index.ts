import { contextBridge, ipcRenderer } from 'electron'

// État de la synchronisation avec le serveur en ligne, tenu à jour par le processus principal.
type SyncState = { reachable: boolean; pending: number; failed: any[]; lastSync: string | null; lastPrefetch: string | null; localBytes: number; needsLogin: boolean }
let syncState: SyncState | null = null
const setSyncState = (s: SyncState | null) => {
  syncState = s
  window.dispatchEvent(new Event('iam-offline'))
}
ipcRenderer.on('offline.changed', (_e, s: SyncState) => setSyncState(s))
ipcRenderer.invoke('offline.state').then(setSyncState, () => {})
ipcRenderer.on('enterprise.changed', () => window.dispatchEvent(new Event('iam-enterprise')))

const bridge = {
  kind: 'desktop' as const,
  call: (name: string, args?: unknown) => ipcRenderer.invoke('api', name, args),
  status: () => ipcRenderer.invoke('app.status'),
  checkUpdate: () => ipcRenderer.invoke('app.checkUpdate'),
  openExternal: (url: string) => ipcRenderer.invoke('app.openExternal', url),
  login: (username: string, password: string) => ipcRenderer.invoke('session.login', username, password),
  setup: (input: unknown) => ipcRenderer.invoke('session.setup', input),
  logout: () => ipcRenderer.invoke('session.logout'),
  getDbConfig: () => ipcRenderer.invoke('db.getConfig'),
  testDbConfig: (cfg: unknown) => ipcRenderer.invoke('db.testConfig', cfg),
  saveDbConfig: (cfg: unknown) => ipcRenderer.invoke('db.saveConfig', cfg),
  pdf: (id: number, action: 'open' | 'save' | 'print', format?: 'a4' | 'ticket') => ipcRenderer.invoke('pdf.document', id, action, format),
  pdfPreview: (id: number, format?: 'a4' | 'ticket') => ipcRenderer.invoke('pdf.preview', id, format),
  saveText: (name: string, content: string) => ipcRenderer.invoke('file.saveText', name, content),
  saveBinary: (name: string, base64: string) => ipcRenderer.invoke('file.saveBinary', name, base64),
  sendDocumentEmail: (input: unknown) => ipcRenderer.invoke('mail.sendDocument', input),
  printHtml: (html: string, filename: string) => ipcRenderer.invoke('print.html', html, filename),
  pickImage: () => ipcRenderer.invoke('file.pickImage'),
  backup: () => ipcRenderer.invoke('backup.create'),
  restore: () => ipcRenderer.invoke('backup.restore'),
  brand: (url?: string) => ipcRenderer.invoke('app.brand', url),
  enterprise: {
    get: () => ipcRenderer.invoke('enterprise.get'),
    save: (input: unknown) => ipcRenderer.invoke('enterprise.save', input),
    push: () => ipcRenderer.invoke('enterprise.push')
  },
  backupAuto: {
    get: () => ipcRenderer.invoke('backup.auto.get'),
    set: (input: { enabled?: boolean; keep?: number }) => ipcRenderer.invoke('backup.auto.set', input),
    chooseDir: () => ipcRenderer.invoke('backup.auto.chooseDir'),
    now: () => ipcRenderer.invoke('backup.auto.now')
  },
  offline: {
    pending: () => syncState?.pending ?? 0,
    failed: () => syncState?.failed ?? [],
    sync: () => ipcRenderer.invoke('offline.sync'),
    clearFailed: () => ipcRenderer.invoke('offline.clearFailed'),
    serverDown: () => (syncState ? !syncState.reachable : false),
    state: () => syncState,
    prefetch: () => ipcRenderer.invoke('offline.prefetch'),
    clearCache: () => ipcRenderer.invoke('offline.clearCache')
  }
}

export type Bridge = typeof bridge

contextBridge.exposeInMainWorld('erp', bridge)
