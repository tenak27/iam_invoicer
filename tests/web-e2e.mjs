// Parcours de l'application web servie par le serveur IAM INVOICER, sur
// ordinateur puis sur téléphone (affichage adaptatif). Utilise Microsoft Edge
// ou Chrome installé sur le poste.
// Usage : npm run build:all-server && DATA_DIR=tmp node out/server/server.cjs
//         node tests/web-e2e.mjs http://127.0.0.1:8080 <dossier-captures>
import { chromium } from 'playwright'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const base = process.argv[2] ?? 'http://127.0.0.1:8080'
const out = resolve(process.argv[3] ?? 'web-e2e-out')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const channel = process.env.BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome')
const browser = await chromium.launch({ channel })
let n = 0
const errors = []

async function open(viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, locale: 'fr-FR' })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  return page
}
const shot = (page, name) => page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`), animations: 'disabled' })
const noOverflow = async (page, where) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflow > 1) throw new Error(`Débordement horizontal sur téléphone (${where}) : ${overflow}px`)
}
const call = (page, name, args) =>
  page.evaluate(async ([name, args]) => {
    const r = await window.erp.call(name, args)
    if (!r.ok) throw new Error(r.error)
    return r.data
  }, [name, args])

// ---------- Ordinateur ----------
const page = await open({ width: 1440, height: 900 })
await page.goto(base)
await page.getByText('Bienvenue dans IAM INVOICER').waitFor()
if (await page.getByLabel('Pays').inputValue() !== 'Burkina Faso') throw new Error('Pays par défaut attendu : Burkina Faso')
await page.getByLabel('Téléphone').fill('+226 25 00 00 00')
await page.getByLabel('Adresse').fill('Ouaga 2000, avenue Pascal Zagré')
await page.getByLabel('RCCM').fill('BF-OUA-01-2024-B12-01234')
await page.getByLabel('N° IFU').fill('00123456A')
await page.getByLabel('Régime fiscal').selectOption('RNI')
await page.getByLabel('Service des impôts').fill('DME Centre')
await page.getByLabel('Nom complet').fill('Ibrahim Konaté')
await page.getByLabel('Mot de passe').first().fill('secret123')
await page.getByLabel('Confirmation').fill('secret123')
await shot(page, 'configuration-burkina')
await page.getByRole('button', { name: 'Terminer la configuration' }).click()
await page.locator('.bento').waitFor()

// Données de démonstration par l'API (même chemin que l'interface).
const client = await call(page, 'parties.save', { kind: 'client', name: 'SONABEL', city: 'Ouagadougou', tax_id: '00045678B' })
const supplier = await call(page, 'parties.save', { kind: 'supplier', name: 'Faso Distribution' })
const products = [
  ['produit', 'Onduleur 1500 VA', 85000, 'Énergie'], ['produit', 'Routeur Wi-Fi 6', 45000, 'Réseau'],
  ['produit', 'Câble RJ45 Cat6 (m)', 500, 'Réseau'], ['produit', 'Caméra IP 4 MP', 65000, 'Sécurité'],
  ['produit', 'Disque SSD 1 To', 55000, 'Informatique'], ['prestation', 'Installation réseau', 50000, 'Services'],
  ['prestation', 'Maintenance mensuelle', 75000, 'Services'], ['produit', 'Clavier + souris', 12000, 'Informatique']
]
const ids = []
for (const [kind, name, price, category] of products) ids.push((await call(page, 'products.save', { kind, name, sale_price: price, purchase_price: Math.round(price * 0.7), tva_rate: 18, category })).id)
const ff = await call(page, 'documents.save', {
  type: 'FF', party_id: supplier.id,
  lines: products.map(([kind, name, price], i) => kind === 'produit' ? { product_id: ids[i], description: name, quantity: 20, unit_price: Math.round(price * 0.7), tva_rate: 18 } : null).filter(Boolean)
})
await call(page, 'documents.validate', { id: ff.id })
const fac = await call(page, 'documents.save', {
  type: 'FAC', party_id: client.id,
  lines: [{ product_id: ids[0], description: 'Onduleur 1500 VA', quantity: 2, unit_price: 85000, tva_rate: 18 }, { product_id: ids[5], description: 'Installation réseau', quantity: 1, unit_price: 50000, tva_rate: 18 }]
})
await call(page, 'documents.validate', { id: fac.id })
await call(page, 'payments.add', { document_id: fac.id, amount: 150000, method: 'Orange Money', reference: 'OM-784512' })

await page.reload()
await page.locator('.bento').waitFor()
await shot(page, 'tableau-de-bord')

// Barre supérieure : notifications, compte, recherche rapide, menu replié
await page.getByRole('button', { name: /^Notifications/ }).click()
await page.locator('.notif-panel').waitFor()
await shot(page, 'notifications')
await page.keyboard.press('Escape')
await page.getByRole('button', { name: /^Compte de/ }).click()
await page.locator('.user-panel').waitFor()
await shot(page, 'menu-compte')
await page.keyboard.press('Escape')
await page.keyboard.press('Control+k')
await page.getByRole('dialog', { name: 'Recherche rapide' }).waitFor()
await page.keyboard.type('balan')
await shot(page, 'recherche-rapide')
await page.keyboard.press('Enter')
await page.locator('tfoot').waitFor()
await page.getByRole('button', { name: 'Replier le menu' }).click()
await shot(page, 'menu-replie')
await page.getByRole('button', { name: 'Déplier le menu' }).click()

// Caisse
await page.locator('.nav-link', { hasText: 'Point de vente' }).click()
await page.getByLabel('Fonds de caisse (FCFA)').fill('25000')
await page.getByRole('button', { name: 'Ouvrir la caisse' }).click()
await page.locator('.pos-tile').first().waitFor()
await page.locator('.pos-tile', { hasText: 'Routeur Wi-Fi 6' }).click()
await page.locator('.pos-tile', { hasText: 'Câble RJ45' }).click()
await page.locator('.pos-tile', { hasText: 'Câble RJ45' }).click()
await page.locator('.pos-tile', { hasText: 'Clavier' }).click()
await shot(page, 'caisse-panier')
await page.getByRole('button', { name: /^Encaisser/ }).click()
await page.getByLabel('Reçu du client').fill('70000')
await page.getByText('Monnaie à rendre').waitFor()
await shot(page, 'caisse-encaissement')
await page.getByRole('button', { name: 'Valider la vente' }).click()
await page.getByText('Vente enregistrée').waitFor()
await shot(page, 'caisse-vente-enregistree')
await page.getByRole('button', { name: 'Nouvelle vente' }).click()

// Vente payée en deux fois (espèces + Moov Money)
await page.locator('.pos-tile', { hasText: 'Disque SSD' }).click()
await page.getByRole('button', { name: /^Encaisser/ }).click()
await page.getByRole('button', { name: '+ Ajouter un autre moyen de paiement' }).click()
await page.locator('.pay-row').nth(0).getByLabel('Montant').fill('40000')
await page.locator('.pay-row').nth(1).getByLabel('Mode').selectOption('Moov Money')
await page.locator('.pay-row').nth(1).getByLabel('Montant').fill('24900')
await page.getByRole('button', { name: 'Valider la vente' }).click()
await page.getByText('Vente enregistrée').waitFor()
await page.getByRole('button', { name: 'Nouvelle vente' }).click()

await page.getByRole('button', { name: 'Sortie / dépense' }).click()
await page.getByLabel('Montant').fill('3500')
await page.getByLabel('Motif').fill('Carburant moto livraison')
await page.locator('.modal').getByRole('button', { name: 'Enregistrer' }).click()
await page.locator('.modal').waitFor({ state: 'detached' })

await page.getByRole('button', { name: 'Clôturer la caisse' }).click()
await page.getByLabel('Espèces comptées dans le tiroir').fill('129940')
await shot(page, 'caisse-cloture')
await page.locator('.modal').getByRole('button', { name: 'Clôturer' }).click()
await page.getByText('Votre caisse est fermée.').waitFor()

// Comptabilité
await page.locator('.nav-link', { hasText: 'Journaux & écritures' }).click()
await page.locator('tbody.entry').first().waitFor()
await shot(page, 'compta-journaux')
await page.locator('.nav-link', { hasText: 'Balance' }).click()
await page.locator('tfoot').waitFor()
const [d, c] = await page.locator('tfoot td.num').allTextContents()
if (d !== c) throw new Error(`Balance déséquilibrée : ${d} / ${c}`)
await shot(page, 'compta-balance')
await page.locator('.nav-link', { hasText: 'Compte de résultat' }).click()
await page.locator('.kpis').waitFor()
await shot(page, 'compta-resultat')

// Paramètres : mentions Burkina
await page.locator('.nav-link', { hasText: 'Société & paramètres' }).click()
await page.getByLabel('Régime fiscal').waitFor()
await shot(page, 'parametres')

// Thème sombre (préférence du système)
await page.emulateMedia({ colorScheme: 'dark' })
await page.locator('.nav-link', { hasText: 'Tableau de bord' }).click()
await page.locator('.bento').waitFor()
await shot(page, 'sombre-tableau-de-bord')
await page.locator('.sidebar').getByRole('link', { name: 'Factures', exact: true }).click()
await page.locator('.table-wrap').first().waitFor()
await shot(page, 'sombre-factures')
await page.emulateMedia({ colorScheme: 'light' })

// ---------- Téléphone (iPhone 14 : 390 × 844) ----------
const phone = await open({ width: 390, height: 844 }, true)
await phone.goto(base)
await phone.getByLabel("Nom d'utilisateur").fill('admin')
await phone.getByLabel('Mot de passe').fill('secret123')
await noOverflow(phone, 'connexion')
await shot(phone, 'mobile-connexion')
await phone.getByRole('button', { name: 'Se connecter' }).click()
await phone.locator('.bento').waitFor()
await shot(phone, 'mobile-tableau-de-bord')
await noOverflow(phone, 'tableau de bord')
await phone.getByRole('button', { name: 'Menu' }).click()
await phone.locator('.nav-open .sidebar').waitFor()
await shot(phone, 'mobile-menu')
await phone.locator('.nav-link', { hasText: 'Point de vente' }).click()
await phone.getByLabel('Fonds de caisse (FCFA)').fill('10000')
await phone.getByRole('button', { name: 'Ouvrir la caisse' }).click()
await phone.locator('.pos-tile').first().waitFor()
await phone.locator('.pos-tile', { hasText: 'Caméra IP' }).tap()
await phone.locator('.pos-tile', { hasText: 'Câble RJ45' }).tap()
await shot(phone, 'mobile-caisse')
await phone.locator('.pos-cart-toggle').tap()
await noOverflow(phone, 'caisse')
await shot(phone, 'mobile-panier')
await phone.getByRole('button', { name: /^Encaisser/ }).tap()
await phone.getByRole('button', { name: 'Orange Money' }).first().tap()
await shot(phone, 'mobile-encaissement')
await phone.getByRole('button', { name: 'Valider la vente' }).tap()
await phone.getByText('Vente enregistrée').waitFor()
await phone.getByRole('button', { name: 'Nouvelle vente' }).tap()
await phone.getByRole('button', { name: 'Menu' }).click()
await phone.locator('.nav-link', { hasText: 'Factures' }).first().click()
await phone.locator('.table').waitFor()
await shot(phone, 'mobile-factures')
await phone.locator('tr.clickable').first().click()
await phone.locator('.lines-table').waitFor()
await noOverflow(phone, 'facture')
await shot(phone, 'mobile-facture')

// Paysage et thème sombre sur téléphone
await phone.setViewportSize({ width: 844, height: 390 })
await noOverflow(phone, 'paysage')
await shot(phone, 'mobile-paysage')
await phone.setViewportSize({ width: 390, height: 844 })
await phone.emulateMedia({ colorScheme: 'dark' })
await phone.locator('.tab-item', { hasText: 'Accueil' }).click()
await phone.locator('.bento').waitFor()
await shot(phone, 'mobile-sombre')

await browser.close()
if (errors.length) {
  console.log(errors.join('\n'))
  process.exit(1)
}
console.log(`Parcours web réussi — ${n} captures dans ${out}`)
