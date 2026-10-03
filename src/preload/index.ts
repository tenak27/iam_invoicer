import { contextBridge, ipcRenderer } from 'electron'

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
  saveText: (name: string, content: string) => ipcRenderer.invoke('file.saveText', name, content),
  sendDocumentEmail: (input: unknown) => ipcRenderer.invoke('mail.sendDocument', input),
  pickImage: () => ipcRenderer.invoke('file.pickImage'),
  backup: () => ipcRenderer.invoke('backup.create'),
  restore: () => ipcRenderer.invoke('backup.restore')
}

export type Bridge = typeof bridge

contextBridge.exposeInMainWorld('erp', bridge)
