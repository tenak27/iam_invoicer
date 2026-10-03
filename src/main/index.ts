import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openBackend, RemoteBackend, type AppConfig, type Backend, type SavedLogin, type SessionVault } from './backend'
import { openDb, restoreLocal } from './db'
import type { PrintFormat } from './printing'
import { AppError, type SessionUser } from './services/context'

const configPath = () => join(app.getPath('userData'), 'config.json')
const localDataDir = () => join(app.getPath('userData'), 'data')
/** Base locale de travail du mode « serveur en ligne » (données consultées, saisies en attente). */
const syncDir = () => join(app.getPath('userData'), 'sync')

/**
 * Connexions mémorisées pour se reconnecter sans réseau, chiffrées par le système
 * (DPAPI sous Windows, Trousseau sous macOS). Sans chiffrement disponible, rien n'est mémorisé.
 */
function createVault(): SessionVault | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined
  const file = () => join(syncDir(), 'sessions.bin')
  const readAll = (): Record<string, SavedLogin> => {
    try {
      return JSON.parse(safeStorage.decryptString(readFileSync(file())))
    } catch {
      return {}
    }
  }
  const key = (url: string, username: string) => `${url}|${username.trim().toLowerCase()}`
  return {
    get: (url, username) => readAll()[key(url, username)] ?? null,
    put: (login) => {
      const all = readAll()
      all[key(login.url, login.username)] = login
      mkdirSync(syncDir(), { recursive: true })
      writeFileSync(file() + '.tmp', safeStorage.encryptString(JSON.stringify(all)))
      renameSync(file() + '.tmp', file())
    }
  }
}

/** Prévient la fenêtre que l'état de synchronisation a changé. */
function pushSyncState() {
  if (backend instanceof RemoteBackend && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('offline.changed', backend.state())
}

function readConfig(): AppConfig {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')).db
  } catch {
    return { mode: 'local' }
  }
}

let backend: Backend | null = null
let backendError: string | null = null
let mainWindow: BrowserWindow | null = null

async function connect(): Promise<void> {
  const cfg = readConfig()
  try {
    if (cfg.mode === 'local') mkdirSync(localDataDir(), { recursive: true })
    backend = await openBackend(cfg.mode === 'local' ? { mode: 'local', dataDir: localDataDir() } : cfg, {
      dataDir: syncDir(),
      vault: createVault(),
      onChange: pushSyncState
    })
    backendError = null
  } catch (e) {
    backend = null
    backendError = e instanceof Error ? e.message : String(e)
  }
}

type Result = { ok: true; data?: unknown } | { ok: false; error: string }
async function guard(fn: () => Promise<unknown>): Promise<Result> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    if (!(e instanceof AppError)) console.error(e)
    return { ok: false, error: e instanceof AppError ? e.message : `Erreur : ${e instanceof Error ? e.message : e}` }
  }
}

function requireBackend(): Backend {
  if (!backend) throw new AppError('Base de données indisponible.')
  return backend
}

function requireSession(): SessionUser {
  const user = backend?.user()
  if (!user) throw new AppError('Session expirée, veuillez vous reconnecter.')
  return user
}

async function renderPdf(html: string, footerTemplate: string, format: PrintFormat): Promise<Buffer> {
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false } })
  try {
    await win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html).toString('base64'))
    if (format === 'ticket') return await win.webContents.printToPDF({ pageSize: { width: 3.15, height: 11.7 }, printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate
    })
  } finally {
    win.destroy()
  }
}

function registerIpc(): void {
  ipcMain.handle('api', async (_e, name: string, args: unknown) => {
    if (!backend) return { ok: false, error: 'Base de données indisponible.' }
    return backend.call(name, args)
  })

  ipcMain.handle('app.status', () => ({
    dbReady: !!backend,
    dbError: backendError,
    dbMode: readConfig().mode,
    serverUrl: backend instanceof RemoteBackend ? backend.url : null,
    version: app.getVersion(),
    platform: process.platform,
    user: backend?.user() ?? null,
    offline: backend instanceof RemoteBackend ? !backend.reachable : false
  }))

  // Synchronisation avec le serveur en ligne (base locale de travail)
  const remote = () => (backend instanceof RemoteBackend ? backend : null)
  ipcMain.handle('offline.state', () => remote()?.state() ?? null)
  ipcMain.handle('offline.sync', async () => (await remote()?.sync()) ?? { sent: 0, failed: 0 })
  ipcMain.handle('offline.clearFailed', () => {
    remote()?.clearFailed()
    return true
  })
  ipcMain.handle('offline.prefetch', () => guard(async () => {
    const b = remote()
    if (!b) return 0
    if (!b.reachable) await b.ping()
    return b.prefetch()
  }))
  ipcMain.handle('offline.clearCache', () => {
    remote()?.clearCache()
    return true
  })

  ipcMain.handle('session.login', (_e, username: string, password: string) =>
    guard(() => requireBackend().login(username, password))
  )
  ipcMain.handle('session.setup', (_e, input: unknown) => guard(() => requireBackend().setup(input)))
  ipcMain.handle('session.logout', async () => {
    await backend?.logout()
    return { ok: true }
  })

  ipcMain.handle('db.getConfig', () => readConfig())
  ipcMain.handle('db.testConfig', (_e, cfg: AppConfig) =>
    guard(async () => {
      if (cfg.mode === 'local') return true
      if (cfg.mode === 'remote') return (await new RemoteBackend(cfg.url).ping()).version
      const test = await openDb(cfg)
      await test.close()
      return true
    })
  )
  ipcMain.handle('db.saveConfig', async (_e, cfg: AppConfig) => {
    writeFileSync(configPath(), JSON.stringify({ db: cfg }, null, 2))
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('pdf.document', (_e, id: number, action: 'open' | 'save' | 'print', format: PrintFormat = 'a4') =>
    guard(async () => {
      requireSession()
      const doc = await requireBackend().printable(id, format)
      if (action === 'print') {
        const win = new BrowserWindow({ show: false })
        await win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(doc.html).toString('base64'))
        win.webContents.print({ printBackground: true }, () => win.destroy())
        return true
      }
      const pdf = await renderPdf(doc.html, doc.footer, format)
      if (action === 'save') {
        const r = await dialog.showSaveDialog(mainWindow!, {
          defaultPath: join(app.getPath('documents'), doc.filename),
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        })
        if (r.canceled || !r.filePath) return false
        writeFileSync(r.filePath, pdf)
        shell.showItemInFolder(r.filePath)
        return r.filePath
      }
      const tmp = process.env.IAM_ERP_PDF_DIR ?? join(app.getPath('temp'), 'iam-invoicer')
      mkdirSync(tmp, { recursive: true })
      const file = join(tmp, doc.filename)
      writeFileSync(file, pdf)
      if (process.env.IAM_ERP_PDF_DIR) return file
      const err = await shell.openPath(file)
      if (err) throw new AppError(`Impossible d'ouvrir le PDF : ${err}`)
      return file
    })
  )

  // Impression d'un HTML quelconque (bulletins de paie, états) : PDF ouvert dans le lecteur.
  ipcMain.handle('print.html', (_e, html: string, filename: string) =>
    guard(async () => {
      requireSession()
      const pdf = await renderPdf(html, '<span></span>', 'a4')
      const dir = process.env.IAM_ERP_PDF_DIR ?? join(app.getPath('temp'), 'iam-invoicer')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, String(filename || 'document').replace(/[\/:*?"<>|]/g, '-') + '.pdf')
      writeFileSync(file, pdf)
      if (process.env.IAM_ERP_PDF_DIR) return file
      const err = await shell.openPath(file)
      if (err) throw new AppError(`Impossible d'ouvrir le PDF : ${err}`)
      return file
    })
  )

  // E-mail d'un document : le PDF est fabriqué ici puis joint au message.
  ipcMain.handle('mail.sendDocument', (_e, input: { documentId: number; to: string; subject: string; body: string }) =>
    guard(async () => {
      requireSession()
      const doc = await requireBackend().printable(input.documentId, 'a4')
      const pdf = await renderPdf(doc.html, doc.footer, 'a4')
      const r = await requireBackend().call('messages.sendDocument', { ...input, pdf: pdf.toString('base64') })
      if (!r.ok) throw new AppError(r.error)
      return true
    })
  )

  ipcMain.handle('file.saveText', (_e, defaultName: string, content: string) =>
    guard(async () => {
      requireSession()
      const r = await dialog.showSaveDialog(mainWindow!, {
        defaultPath: join(app.getPath('documents'), defaultName),
        filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }]
      })
      if (r.canceled || !r.filePath) return false
      // BOM UTF-8 pour qu'Excel reconnaisse les accents.
      writeFileSync(r.filePath, '﻿' + content, 'utf8')
      shell.showItemInFolder(r.filePath)
      return r.filePath
    })
  )

  ipcMain.handle('file.pickImage', () =>
    guard(async () => {
      const r = await dialog.showOpenDialog(mainWindow!, { filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg'] }] })
      if (r.canceled || !r.filePaths[0]) return null
      const file = r.filePaths[0]
      const buf = readFileSync(file)
      if (buf.length > 1_000_000) throw new AppError('Image trop lourde (1 Mo maximum).')
      const ext = file.split('.').pop()!.toLowerCase()
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : 'image/jpeg'
      return `data:${mime};base64,${buf.toString('base64')}`
    })
  )

  ipcMain.handle('backup.create', () =>
    guard(async () => {
      if (requireSession().role !== 'admin') throw new AppError('Réservé aux administrateurs.')
      const d = requireBackend().db
      if (!d?.dump) throw new AppError('Avec un serveur, la sauvegarde se fait sur le serveur PostgreSQL (pg_dump).')
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
      const r = await dialog.showSaveDialog(mainWindow!, {
        defaultPath: join(app.getPath('documents'), `iam-invoicer-sauvegarde-${stamp}.tar.gz`),
        filters: [{ name: 'Sauvegarde IAM INVOICER', extensions: ['gz'] }]
      })
      if (r.canceled || !r.filePath) return false
      const blob = await d.dump()
      writeFileSync(r.filePath, Buffer.from(await blob.arrayBuffer()))
      return r.filePath
    })
  )

  ipcMain.handle('backup.restore', () =>
    guard(async () => {
      if (requireSession().role !== 'admin') throw new AppError('Réservé aux administrateurs.')
      if (readConfig().mode !== 'local') throw new AppError('Avec un serveur, la restauration se fait sur le serveur PostgreSQL.')
      const r = await dialog.showOpenDialog(mainWindow!, { filters: [{ name: 'Sauvegarde IAM INVOICER', extensions: ['gz'] }] })
      if (r.canceled || !r.filePaths[0]) return false
      const confirm = await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        buttons: ['Annuler', 'Restaurer'],
        defaultId: 0,
        cancelId: 0,
        message: 'Remplacer toutes les données actuelles par cette sauvegarde ?',
        detail: "Les données actuelles seront conservées dans un dossier « data-avant-restauration ». L'application va redémarrer."
      })
      if (confirm.response !== 1) return false
      const archive = new Blob([readFileSync(r.filePaths[0])])
      const staging = localDataDir() + '-restauration'
      rmSync(staging, { recursive: true, force: true })
      await restoreLocal(archive, staging) // vérifie que l'archive est lisible avant de toucher aux données
      await backend?.close()
      backend = null
      const previous = localDataDir() + '-avant-restauration'
      rmSync(previous, { recursive: true, force: true })
      if (existsSync(localDataDir())) renameSync(localDataDir(), previous)
      renameSync(staging, localDataDir())
      app.relaunch()
      app.exit(0)
      return true
    })
  )
}

function appIcon() {
  const file = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../resources/icon.png')
  return existsSync(file) ? nativeImage.createFromPath(file) : undefined
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: 'IAM INVOICER',
    icon: appIcon(),
    backgroundColor: '#f3f5f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.maximize())
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

// Dossier de données alternatif (tests automatisés, plusieurs sociétés).
if (process.env.IAM_ERP_DATA) app.setPath('userData', process.env.IAM_ERP_DATA)
else {
  // Installations antérieures au nom « IAM INVOICER » : on garde le dossier existant.
  const legacy = ['IAM ERP', 'iam-erp'].map((n) => join(app.getPath('appData'), n)).find((d) => existsSync(join(d, 'data')))
  if (legacy && !existsSync(join(app.getPath('userData'), 'data'))) app.setPath('userData', legacy)
}

/**
 * Toutes les 30 s : retente le serveur s'il était injoignable et envoie les saisies en attente.
 * Toutes les 10 min : rafraîchit la base locale avec les données des autres postes.
 */
function startSyncLoop() {
  let ticks = 0
  setInterval(async () => {
    const b = backend instanceof RemoteBackend ? backend : null
    if (!b?.user()) return
    ticks++
    try {
      if (!b.reachable) await b.ping()
      if (b.state().pending) await b.sync()
      if (b.reachable && ticks % 20 === 0) await b.prefetch()
    } catch {
      /* toujours hors connexion : nouvel essai au prochain passage */
    }
  }, 30_000).unref()
}

app.whenReady().then(async () => {
  if (app.isPackaged && process.platform !== 'darwin') Menu.setApplicationMenu(null)
  registerIpc()
  await connect()
  createWindow()
  startSyncLoop()
  // macOS : rouvrir la fenêtre quand on clique sur l'icône du Dock.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  if (process.platform === 'darwin' && backend) return
  await backend?.close().catch(() => {})
  app.quit()
})

app.on('before-quit', () => {
  backend?.close().catch(() => {})
})
