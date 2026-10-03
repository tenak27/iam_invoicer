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

const bridge = {
  kind: 'desktop' as const,
  call: (name: string, args?: unknown) => ipcRenderer.invoke('api', name, args),
  status: () => ipcRenderer.invoke('app.status'),
  login: (username: string, password: string) => ipcRenderer.invoke('session.login', username, password),
  setup: (input: unknown) => ipcRenderer.invoke('session.setup', input),
  logout: () => ipcRenderer.invoke('session.logout'),
  getDbConfig: () => ipcRenderer.invoke('db.getConfig'),
  testDbConfig: (cfg: unknown) => ipcRenderer.invoke('db.testConfig', cfg),
  saveDbConfig: (cfg: unknown) => ipcRenderer.invoke('db.saveConfig', cfg),
  pdf: (id: number, action: 'open' | 'save' | 'print', format?: 'a4' | 'ticket') => ipcRenderer.invoke('pdf.document', id, action, format),
  pdfPreview: (id: number, format?: 'a4' | 'ticket') => ipcRenderer.invoke('pdf.preview', id, format),
  saveText: (name: string, content: string) => ipcRenderer.invoke('file.saveText', name, content),
  sendDocumentEmail: (input: unknown) => ipcRenderer.invoke('mail.sendDocument', input),
  printHtml: (html: string, filename: string) => ipcRenderer.invoke('print.html', html, filename),
  pickImage: () => ipcRenderer.invoke('file.pickImage'),
  backup: () => ipcRenderer.invoke('backup.create'),
  restore: () => ipcRenderer.invoke('backup.restore'),
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
