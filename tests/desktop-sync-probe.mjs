// Parcours réel de l'application de bureau reliée à un serveur en ligne :
// connexion, base locale, coupure du serveur, saisie hors ligne, retour du serveur.
// Usage : npm run build && npm run build:server && node tests/desktop-sync-probe.mjs [dossier]
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const out = resolve(process.argv[2] ?? 'sync-probe-out')
const port = 8799
const url = `http://127.0.0.1:${port}`
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'app'), { recursive: true })

let server = null
const startServer = async () => {
  server = spawn(process.execPath, ['out/server/server.cjs'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: join(out, 'server-data') }, stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url + '/api/status')).ok) return
    } catch { /* démarrage en cours */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('serveur non démarré')
}
const stopServer = async () => {
  server.kill()
  await new Promise((r) => server.once('exit', r))
}
const api = async (path, body, token) => (await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json()

await startServer()
const setup = await api('/api/setup', { company: { name: 'IAM Technology' }, username: 'admin', full_name: 'Ibrahim Konaté', password: 'secret123' })
const token = setup.data.token
await api('/api/call', { name: 'parties.save', args: { kind: 'client', name: 'SONABEL', city: 'Ouagadougou' } }, token)

writeFileSync(join(out, 'app', 'config.json'), JSON.stringify({ db: { mode: 'remote', url } }))
const app = await electron.launch({
  args: ['.'],
  env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')), IAM_ERP_DATA: join(out, 'app') }
})
const page = await app.firstWindow()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.setViewportSize({ width: 1440, height: 900 })
let n = 0
const shot = (name) => page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
const go = (label) => page.locator('.sidebar').getByRole('link', { name: label, exact: true }).click()

// 1. Connexion en ligne
await page.getByLabel("Nom d'utilisateur").fill('admin')
await page.getByLabel('Mot de passe').fill('secret123')
await page.getByRole('button', { name: /Se connecter/ }).click()
await page.locator('.kpi-tile').first().waitFor()
await page.waitForTimeout(2500) // préchargement de la base locale

// 2. État de la base locale
await go('Société & paramètres')
await page.getByRole('tab', { name: 'Données' }).click()
await page.getByRole('heading', { name: 'Base locale de ce poste' }).waitFor()
await shot('base-locale-en-ligne')

// 3. Coupure du serveur : les clients restent consultables, un nouveau client part en file d'attente
await stopServer()
await go('Clients')
await page.locator('tr', { hasText: 'SONABEL' }).waitFor()
await page.getByRole('button', { name: 'Nouveau client' }).click()
await page.getByLabel('Nom / raison sociale').fill('Boutique Wend-Kuni')
await page.locator('.modal').getByRole('button', { name: 'Enregistrer' }).click()
await page.locator('.offline-bar', { hasText: '1 saisie(s) en attente' }).waitFor()
await shot('hors-ligne-saisie-en-attente')

// 4. Redémarrage du poste sans serveur : connexion sur la base locale
await app.close()
const app2 = await electron.launch({
  args: ['.'],
  env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')), IAM_ERP_DATA: join(out, 'app') }
})
const page2 = await app2.firstWindow()
page2.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page2.setViewportSize({ width: 1440, height: 900 })
await page2.getByLabel("Nom d'utilisateur").fill('admin')
await page2.getByLabel('Mot de passe').fill('secret123')
await page2.getByRole('button', { name: /Se connecter/ }).click()
await page2.locator('.offline-bar').waitFor()
await page2.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-connexion-hors-ligne.png`) })

// 5. Retour du serveur : envoi automatique (boucle de 30 s) ou bouton Synchroniser
await startServer()
// La boucle du poste retente le serveur toutes les 30 s puis envoie seule la file d'attente.
await page2.locator('.offline-bar').waitFor({ state: 'detached', timeout: 90_000 })
const list = await api('/api/call', { name: 'parties.options', args: { kind: 'client' } }, token)
const names = list.data.map((p) => p.name)
if (!names.includes('Boutique Wend-Kuni')) throw new Error('client hors ligne non synchronisé : ' + names.join(', '))
if (names.filter((x) => x === 'Boutique Wend-Kuni').length !== 1) throw new Error('doublon')
await page2.locator('.sidebar').getByRole('link', { name: 'Société & paramètres', exact: true }).click()
await page2.getByRole('tab', { name: 'Données' }).click()
await page2.getByRole('heading', { name: 'Base locale de ce poste' }).waitFor()
await page2.waitForTimeout(400)
await page2.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-synchronise.png`) })
await app2.close()
await stopServer()
console.log('Synchronisation bureau OK — ' + out)
