// Parcours de l'application web servie par le serveur IAM INVOICER, sur
// ordinateur puis sur téléphone (affichage adaptatif). Utilise Microsoft Edge
// ou Chrome installé sur le poste.
// Usage : npm run build:all-server && DATA_DIR=tmp node out/server/server.cjs
//         node tests/web-e2e.mjs http://127.0.0.1:8080 <dossier-captures>
import { chromium } from 'playwright'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { makeXlsx } from './make-xlsx.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:8080'
const out = resolve(process.argv[3] ?? 'web-e2e-out')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const channel = process.env.BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome')
const browser = await chromium.launch({ channel })
let n = 0
const errors = []

async function open(viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, locale: 'fr-FR', reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  return page
}
const shot = (page, name) => page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
const noOverflow = async (page, where) => {
  // En mode mobile, innerWidth suit le contenu : on compare à la largeur réelle de l'écran.
  const width = page.viewportSize().width
  const overflow = await page.evaluate((w) => document.documentElement.scrollWidth - w, width)
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
if (await page.getByLabel('Pays').inputValue() !== 'BF') throw new Error('Pays par défaut attendu : Burkina Faso')
await page.getByLabel('Raison sociale').fill('IAM Technology')
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
await page.locator('.kpi-tile').first().waitFor()

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
await page.locator('.kpi-tile').first().waitFor()
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

// Signature sur place puis à distance d'une facture
const drawOn = async (p, canvas) => {
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  await p.mouse.move(box.x + 30, box.y + box.height * 0.6)
  await p.mouse.down()
  for (let i = 1; i <= 24; i++) await p.mouse.move(box.x + 30 + i * 12, box.y + box.height * (0.6 + 0.25 * Math.sin(i / 2.5)))
  await p.mouse.up()
}
await page.locator('.sidebar').getByRole('link', { name: 'Factures', exact: true }).click()
await page.locator('tr.clickable').first().click()
await page.getByRole('button', { name: 'Faire signer sur place' }).click()
await page.getByLabel('Nom et prénom du signataire').fill('Moussa Sawadogo')
await drawOn(page, page.locator('.modal canvas'))
await page.getByRole('button', { name: 'Valider la signature' }).click()
await page.locator('.sig-item').first().waitFor()
await page.getByRole('button', { name: 'Lien de signature à distance' }).click()
const signLink = (await page.locator('.link-box code').textContent()).trim()
await shot(page, 'signatures')
const clientPage = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
await clientPage.goto(signLink)
await clientPage.getByLabel('Nom et prénom du signataire').fill('Aminata Ouédraogo')
await drawOn(clientPage, clientPage.locator('#pad'))
await shot(clientPage, 'signature-client-mobile')
await clientPage.getByRole('button', { name: 'Signer et valider' }).click()
await clientPage.getByText('Merci, document signé').waitFor()
await clientPage.waitForTimeout(800)
await shot(clientPage, 'signature-client-ok')
await page.reload()
await page.locator('.sig-item').nth(1).waitFor()

// Communications
await page.locator('.nav-link', { hasText: 'E-mails et SMS' }).click()
await page.getByRole('heading', { name: 'Communications' }).waitFor()
await shot(page, 'communications')
await page.locator('.nav-link', { hasText: 'Modèles de messages' }).click()
await page.locator('.tpl-card').first().waitFor()
await page.locator('.tpl-card').first().getByRole('button', { name: 'Modifier' }).click()
await page.locator('.var-chips').waitFor()
await shot(page, 'modele-message')
await page.keyboard.press('Escape')
await page.locator('.nav-link', { hasText: 'Société & paramètres' }).click()
await page.getByRole('tab', { name: 'Documents & signature' }).click()
await page.locator('.swatches').waitFor()
await shot(page, 'parametres-documents')
await page.getByRole('tab', { name: 'Société', exact: true }).click()

// Modules ERP
const navTo = async (label) => {
  await page.locator('.sidebar').getByRole('link', { name: label, exact: true }).click()
  await page.waitForTimeout(150)
}
// Stock avancé
await navTo('Dépôts, transferts, lots')
await page.getByRole('heading', { name: 'Dépôts, transferts et lots' }).waitFor()
await page.getByRole('tab', { name: 'Dépôts', exact: true }).click()
await page.getByRole('button', { name: 'Nouveau dépôt' }).click()
await page.getByLabel('Code').fill('BOBO')
await page.getByLabel('Nom', { exact: true }).fill('Agence Bobo-Dioulasso')
await page.locator('.modal').getByRole('button', { name: 'Enregistrer' }).click()
await page.locator('.pick-card', { hasText: 'Agence Bobo-Dioulasso' }).waitFor()
await page.getByRole('tab', { name: 'Stock par dépôt' }).click()
await page.locator('.table-wrap').waitFor()
await shot(page, 'stock-par-depot')

// RH et paie
await navTo('Ressources humaines')
await page.getByRole('button', { name: 'Nouveau salarié' }).click()
await page.getByLabel('Prénom').fill('Issa')
await page.getByLabel('Nom', { exact: true }).fill('Compaoré')
await page.getByLabel('Emploi').fill('Technicien réseau')
await page.getByLabel('Salaire de base').fill('200000')
await page.getByLabel('Indemnité de logement').fill('50000')
await page.getByLabel('Indemnité de transport').fill('20000')
await page.getByLabel('Charges de famille').fill('2')
await page.locator('.pay-preview .net').getByText('237 754 FCFA').waitFor()
await shot(page, 'rh-salarie')
await page.locator('.modal').getByRole('button', { name: 'Enregistrer' }).click()
await page.locator('tr.clickable', { hasText: 'Issa Compaoré' }).waitFor()
await page.getByRole('tab', { name: 'Paie', exact: true }).click()
await page.getByRole('button', { name: 'Préparer la paie' }).click()
await page.getByText('237 754').first().waitFor()
await shot(page, 'rh-paie')

// CRM
await navTo('CRM et opportunités')
await page.getByRole('button', { name: 'Nouvelle opportunité' }).click()
await page.getByLabel('Intitulé').fill('Vidéosurveillance du siège')
await page.getByLabel('Nom du prospect').fill('Banque Commerciale du Burkina')
await page.getByLabel('Montant TTC estimé').fill('3540000')
await page.locator('.modal').getByRole('button', { name: 'Enregistrer' }).click()
await page.locator('.kanban-card', { hasText: 'Vidéosurveillance' }).waitFor()
await page.getByRole('button', { name: /Passer « Vidéosurveillance du siège » à l'étape Qualifié/ }).click()
await page.locator('.kanban-col[aria-label="Qualifié"] .kanban-card').waitFor()
await shot(page, 'crm-pipeline')

// Projets
await navTo('Projets et chantiers')
await page.getByRole('button', { name: 'Nouveau projet' }).click()
await page.getByLabel('Nom du projet').fill('Câblage agence de Koudougou')
await page.getByLabel('Taux horaire HT').fill('15000')
await page.getByLabel('Budget en heures').fill('40')
await page.locator('.modal').getByRole('button', { name: 'Enregistrer' }).click()
await page.getByRole('button', { name: 'Saisir du temps' }).click()
await page.getByLabel('Heures').fill('6')
await page.getByLabel('Travail effectué').fill('Tirage des câbles')
await page.locator('.modal').getByRole('button', { name: 'Enregistrer' }).click()
await page.getByText('Tirage des câbles').waitFor()
await shot(page, 'projet')

// Immobilisations
await navTo('Immobilisations')
await page.getByRole('button', { name: 'Nouveau bien' }).click()
await page.getByLabel('Désignation').fill('Ordinateurs portables (x5)')
await page.getByLabel('Valeur HT').fill('2500000')
await page.getByLabel("Comptabiliser l'acquisition").selectOption('481')
await page.locator('.modal').getByRole('button', { name: 'Enregistrer' }).click()
await page.locator('tr', { hasText: 'Ordinateurs portables' }).waitFor()
await shot(page, 'immobilisations')

// Trésorerie prévisionnelle
await navTo('Budgets et trésorerie')
await page.locator('.cash-chart').waitFor()
await shot(page, 'tresorerie')

// Paramètres : mentions Burkina
await page.locator('.nav-link', { hasText: 'Société & paramètres' }).click()
await page.getByLabel('Régime fiscal').waitFor()
await shot(page, 'parametres')

// Taxes de facturation : modèles du pays puis droit de timbre automatique
await page.getByRole('tab', { name: 'Taxes' }).click()
await page.getByRole('button', { name: 'Ajouter les modèles du pays' }).click()
await page.locator('tr', { hasText: 'TIMBRE' }).getByRole('button', { name: 'Modifier' }).click()
await page.locator('.modal').getByRole('textbox', { name: 'Montant' }).fill('200')
await page.locator('.modal').getByLabel('Active').check()
await page.locator('.modal').getByRole('button', { name: 'Enregistrer' }).click()
await page.locator('tr', { hasText: 'TIMBRE' }).getByText('Active', { exact: true }).waitFor()
await shot(page, 'taxes')

// Import de clients depuis un classeur Excel
await navTo('Importer des données')
await page.getByRole('button', { name: /Clients/ }).click()
await page.locator('input[type=file]').setInputFiles({
  name: 'clients.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: makeXlsx([
    ['Raison sociale', 'Tél.', 'Ville', 'N° IFU', 'Délai de paiement'],
    ['Pharmacie du Progrès', '70 12 34 56', 'Bobo-Dioulasso', '00045678B', 30],
    ['Boutique Wend-Kuni', '76 00 11 22', 'Ouagadougou', '', 15],
    ['', '78 00 00 00', 'Koudougou', '', '']
  ])
})
await page.getByRole('button', { name: /Importer 3 ligne/ }).waitFor()
await shot(page, 'import-apercu')
await page.getByRole('button', { name: /Importer 3 ligne/ }).click()
await page.locator('.import-report').getByText('Refusés').waitFor()
await shot(page, 'import-compte-rendu')
await page.locator('.sidebar').getByRole('link', { name: 'Clients', exact: true }).click()
await page.locator('tr', { hasText: 'Pharmacie du Progrès' }).waitFor()

// États financiers et déclarations
await navTo('Bilan')
await page.locator('.bs-total').first().waitFor()
await shot(page, 'bilan')
await navTo('Déclarations')
await page.getByRole('heading', { name: /^TVA/ }).waitFor()
await shot(page, 'declarations')

// Licence : évaluation et offres
await navTo('Licence')
await page.locator('.tier-card').first().waitFor()
if (!(await page.locator('.licence-bar').textContent()).includes('évaluation')) throw new Error("bandeau d'évaluation attendu")
await shot(page, 'licence')

// Thème sombre (préférence du système)
await page.emulateMedia({ colorScheme: 'dark' })
await page.locator('.nav-link', { hasText: 'Tableau de bord' }).click()
await page.locator('.kpi-tile').first().waitFor()
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
await phone.locator('.kpi-tile').first().waitFor()
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
for (const [label, name] of [['CRM et opportunités', 'mobile-crm'], ['Ressources humaines', 'mobile-rh'], ['Budgets et trésorerie', 'mobile-tresorerie']]) {
  await phone.getByRole('button', { name: 'Menu' }).click()
  await phone.locator('.nav-open .sidebar').getByRole('link', { name: label, exact: true }).click()
  await phone.waitForTimeout(400)
  await noOverflow(phone, name)
  await shot(phone, name)
}

// Paysage et thème sombre sur téléphone
await phone.setViewportSize({ width: 844, height: 390 })
await noOverflow(phone, 'paysage')
await shot(phone, 'mobile-paysage')
await phone.setViewportSize({ width: 390, height: 844 })
await phone.emulateMedia({ colorScheme: 'dark' })
await phone.locator('.tab-item', { hasText: 'Accueil' }).click()
await phone.locator('.kpi-tile').first().waitFor()
await shot(phone, 'mobile-sombre')

await browser.close()
if (errors.length) {
  console.log(errors.join('\n'))
  process.exit(1)
}
console.log(`Parcours web réussi — ${n} captures dans ${out}`)
