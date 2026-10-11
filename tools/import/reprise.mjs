#!/usr/bin/env node
// Reprise de l'historique d'une société dans une base IAM INVOICER en ligne, à partir d'un
// export JSON (clients, factures, devis, lignes, bons de livraison, bons de commande).
//
//   node tools/import/reprise.mjs --url https://domaine/t/societe --user identifiant --file export.json
//   (mot de passe : variable IAM_PASSWORD, sinon demandé au clavier ; --dry-run pour simuler)
//
// Tout passe par l'API de l'application, avec les mêmes contrôles qu'une saisie à l'écran :
//  - clients regroupés par nom (les doublons de nom deviennent une seule fiche) ;
//  - documents recréés avec leur numéro d'origine dans « Référence » : l'application attribue
//    ses propres numéros à la validation ;
//  - statuts : validé → validé ; payé → validé et réglé ; brouillon et en attente → brouillon ;
//    devis annulé → validé puis annulé ; facture annulée → brouillon marqué « ANNULÉE »
//    (une facture validée ne s'annule que par un avoir) ;
//  - bons d'enlèvement (copies automatiques des bons de livraison) : non repris.
// Un fichier « produits » (liste JSON d'articles) se reprend avec la même commande.
// Le compte rendu liste ce qui a été créé et tout ce qui demande une vérification.

import { readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const low = (s) => String(s ?? '').trim().toLowerCase()
const txt = (s) => String(s ?? '').trim()
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR')
const lineKey = (type, d) => [type, d['Numéro'] ?? '', low(d.Client), d.Date].join('|')

/** Fiches clients : une par nom (sans tenir compte des majuscules), informations fusionnées. */
export function mergeClients(clients) {
  const byName = new Map()
  for (const c of clients ?? []) {
    const k = low(c.Nom)
    if (!k) continue
    const cur = byName.get(k)
    if (!cur) {
      byName.set(k, { name: txt(c.Nom), phone: txt(c['Téléphone']), email: txt(c.Email), address: txt(c.Adresse), tax_id: txt(c.IFU), rccm: txt(c.RCCM), regime: txt(c['Régime fiscal']), extra: [], merged: 1, company: c.Type === 'entreprise' })
      continue
    }
    cur.merged++
    if (c.Type === 'entreprise' && !cur.company) {
      cur.company = true
      cur.name = txt(c.Nom)
    }
    for (const [field, label, v] of [['phone', 'Autre téléphone', c['Téléphone']], ['email', 'Autre e-mail', c.Email], ['address', 'Autre adresse', c.Adresse], ['tax_id', 'Autre IFU', c.IFU], ['rccm', 'Autre RCCM', c.RCCM], ['regime', 'Autre régime fiscal', c['Régime fiscal']]]) {
      const val = txt(v)
      if (!val) continue
      if (!cur[field]) cur[field] = val
      else if (low(cur[field]) !== low(val) && !cur.extra.includes(`${label} : ${val}`)) cur.extra.push(`${label} : ${val}`)
    }
  }
  return [...byName.values()]
}

const SERVICE = /abonnement|logiciel|domaine|main d.?oeuvre|pose |conception|installation|migration|support et|reliquat|frais|paiement|clonage|sécurisation|ouverture|licence|vps|odoo|ocr|extension/i

/**
 * Articles et prestations (fichier « produits »). Référence d'origine gardée si elle est courte et
 * unique, sinon attribuée par l'application ; un article de même désignation déjà présent est laissé tel quel.
 */
export async function runProducts({ rpc, produits, log = () => {}, dryRun = false }) {
  const report = { crees: 0, existants: 0, produits: 0, prestations: 0, aVerifier: [], erreurs: [] }
  const existing = dryRun ? [] : await rpc('products.list', { includeInactive: true })
  const names = new Set(existing.map((p) => low(p.name)))
  const refs = new Set(existing.map((p) => low(p.ref)))
  for (const src of produits ?? []) {
    const name = txt(src['Désignation'])
    if (!name) continue
    if (names.has(low(name))) {
      report.existants++
      continue
    }
    const kind = SERVICE.test(`${src['Catégorie'] ?? ''} ${name}`) ? 'prestation' : 'produit'
    let ref = txt(src['Référence'])
    if (low(ref) === low(name) || ref.length > 20) ref = ''
    else if (refs.has(low(ref))) {
      report.aVerifier.push(`${name} : référence ${ref} déjà utilisée — nouvelle référence attribuée`)
      ref = ''
    }
    let sale = Number(src['Prix vente']) || 0
    const last = /dernier PU facturé : ([\d.]+)/.exec(src.Remarque ?? '')
    if (!sale && last) {
      sale = Number(last[1])
      report.aVerifier.push(`${name} : prix de vente à 0 — dernier prix facturé repris (${fmt(sale)})`)
    }
    let min = Number(src['Stock minimum']) || 0
    if (min >= 1000) {
      report.aVerifier.push(`${name} : stock minimum de ${fmt(min)} manifestement erroné — remis à 0`)
      min = 0
    }
    if (src['TVA %'] === null || src['TVA %'] === undefined) report.sansTva = (report.sansTva ?? 0) + 1
    const body = { kind, ref, name, description: txt(src.Description), category: txt(src['Catégorie']), unit: txt(src['Unité']), sale_price: sale, purchase_price: Number(src['Prix achat']) || 0, tva_rate: src['TVA %'] ?? 18, min_stock: min, active: src.Statut !== 'inactif' }
    try {
      if (!dryRun) await rpc('products.save', body)
      names.add(low(name))
      if (ref) refs.add(low(ref))
      report.crees++
      kind === 'produit' ? report.produits++ : report.prestations++
    } catch (e) {
      report.erreurs.push(`${name} : ${e.message}`)
    }
  }
  if (report.sansTva) report.aVerifier.push(`${report.sansTva} article(s) sans taux de TVA dans l'export : 18 % appliqué`)
  log(`Articles : ${report.crees} créés (${report.produits} produits, ${report.prestations} prestations), ${report.existants} déjà présents`)
  return report
}

/** Lignes d'un document : détail de l'export, sinon une ligne unique portant le montant. */
function buildLines(doc, detail, { amount, label }) {
  const ht = Number(doc['Montant HT']) || 0
  const tva = Number(doc.TVA) || 0
  const ttc = amount ?? (Number(doc['Montant TTC']) || 0)
  const docRate = ht > 0 && tva > 0 ? Math.round((tva / ht) * 10000) / 100 : 0
  const notes = []
  const total = (lines) => {
    const bases = new Map()
    for (const l of lines) bases.set(l.tva_rate, (bases.get(l.tva_rate) ?? 0) + Math.round(l.quantity * l.unit_price * (1 - l.discount / 100)))
    let sum = 0
    for (const [rate, base] of bases) sum += base + Math.round((base * rate) / 100)
    return sum
  }
  let lines = (detail ?? [])
    .filter((l) => txt(l['Désignation']))
    .map((l) => ({ product_id: null, description: txt(l['Désignation']), quantity: Number(l['Quantité']) || 1, unit_price: Number(l['Prix unitaire']) || 0, discount: Number(l.Remise) || 0, tva_rate: Number(l['TVA %']) || 0 }))
  if (lines.length) {
    if (amount === undefined || Math.abs(total(lines) - ttc) <= 1) return { lines, notes, ecart: amount === undefined ? 0 : total(lines) - ttc }
    // Le total du document fait foi sur le taux de TVA des lignes
    const fixed = lines.map((l) => ({ ...l, tva_rate: docRate }))
    if (Math.abs(total(fixed) - ttc) <= 1) return { lines: fixed, notes: [`TVA des lignes alignée sur le total du document (${docRate} %)`], ecart: 0 }
    return { lines, notes, ecart: total(lines) - ttc }
  }
  // Pas de détail : le net à payer fait foi
  const base = ttc - tva
  if (Math.abs(ht + tva - ttc) > 1) notes.push(`montant HT d'origine ${fmt(ht)}, net repris ${fmt(ttc)}`)
  lines = [{ product_id: null, description: `Reprise de l'historique — ${label} (détail des lignes non repris)`, quantity: 1, unit_price: base, discount: 0, tva_rate: tva > 0 ? docRate : 0 }]
  return { lines, notes, ecart: total(lines) - ttc }
}

/**
 * Reprise complète. `rpc(nom, arguments)` appelle l'API et renvoie le résultat (ou lève une erreur).
 * Renvoie le compte rendu ; `log` reçoit l'avancement.
 */
export async function runReprise({ rpc, data, log = () => {}, dryRun = false }) {
  const report = { clients: { crees: 0, existants: 0, fusionnes: [] }, fournisseurs: 0, documents: {}, reglements: [], ecarts: [], aVerifier: [], nonRepris: [], erreurs: [] }
  const count = (type, state) => {
    report.documents[type] ??= { brouillon: 0, valide: 0, annule: 0 }
    report.documents[type][state]++
  }

  // ── Tiers ──
  const partyId = { client: new Map(), supplier: new Map() }
  for (const kind of ['client', 'supplier']) for (const p of dryRun ? [] : await rpc('parties.list', { kind, includeInactive: true })) partyId[kind].set(low(p.name), p.id)
  const ensureParty = async (kind, fields) => {
    const k = low(fields.name)
    if (partyId[kind].has(k)) return (fields.listed && report.clients.existants++, partyId[kind].get(k))
    const { listed: _listed, ...party } = fields
    const id = dryRun ? -1 : (await rpc('parties.save', { kind, ...party })).id
    partyId[kind].set(k, id)
    kind === 'client' ? report.clients.crees++ : report.fournisseurs++
    return id
  }
  for (const c of mergeClients(data.clients)) {
    if (c.merged > 1) report.clients.fusionnes.push(`${c.name} (${c.merged} fiches)`)
    const notes = [c.regime && `Régime fiscal : ${c.regime}`, ...c.extra, c.merged > 1 && `${c.merged} fiches de même nom fusionnées à la reprise`].filter(Boolean).join('\n')
    await ensureParty('client', { listed: true, name: c.name, phone: c.phone, email: c.email, address: c.address, tax_id: c.tax_id, rccm: c.rccm, notes })
  }
  log(`Clients : ${report.clients.crees} créés, ${report.clients.existants} déjà présents`)

  // ── Lignes de détail, par document ──
  const detail = new Map()
  for (const l of data.lignes ?? []) {
    const k = lineKey(l.Type, l)
    detail.set(k, [...(detail.get(k) ?? []), l])
  }
  const detailOf = (type, d) => (Number(d['Nb lignes']) > 0 ? detail.get(lineKey(type, d)) : undefined)
  const chrono = (list) => [...(list ?? [])].reverse().sort((a, b) => String(a.Date ?? a['Date commande']).localeCompare(String(b.Date ?? b['Date commande'])))

  const create = async ({ type, src, label, party, date, due, lines, sourceId, notes, reference, target, origStatus }) => {
    const info = [`Reprise de l'historique — statut d'origine : ${origStatus ?? 'inconnu'}`, src.Anomalies && `anomalies signalées : ${src.Anomalies}`, ...notes].filter(Boolean).join(' ; ')
    const body = { type, party_id: party, date, due_date: due || undefined, reference, notes: [txt(src.Notes), info].filter(Boolean).join('\n'), source_id: sourceId, lines: lines.lines, taxes: [] }
    if (dryRun) return (count(type, target === 'annule' ? 'annule' : target), -1)
    let id
    try {
      id = (await rpc('documents.save', body)).id
      if (target !== 'brouillon') await rpc('documents.validate', { id })
      count(type, target === 'annule' ? 'valide' : target)
    } catch (e) {
      report.erreurs.push(`${label} : ${e.message}`)
      if (id) count(type, 'brouillon')
      return id ?? null
    }
    if (Math.abs(lines.ecart) > 1) report.ecarts.push(`${label} : écart de ${fmt(lines.ecart)} entre les lignes et le total d'origine`)
    return id
  }
  const clientOf = async (d, label) => {
    const name = txt(d.Client)
    if (!name) return (report.erreurs.push(`${label} : client absent`), null)
    return ensureParty('client', { name })
  }

  // ── Devis ──
  const devisId = new Map()
  const toCancel = []
  for (const d of chrono(data.devis)) {
    const label = `Devis ${d['Numéro'] ?? '(sans numéro)'} du ${d.Date} — ${d.Client}`
    const party = await clientOf(d, label)
    if (!party) continue
    const st = d.Statut
    const target = st === 'annulee' ? 'annule' : ['validee', 'converti', 'payee_partiellement'].includes(st) ? 'valide' : 'brouillon'
    const lines = buildLines(d, detailOf('Devis', d), { amount: Number(d['Montant TTC']) || 0, label: d['Numéro'] ?? 'devis' })
    const notes = [...lines.notes]
    if (Number(d['Payé']) > 0) {
      notes.push(`acompte de ${fmt(d['Payé'])} reçu dans l'ancien système (à enregistrer sur la facture)`)
      report.aVerifier.push(`${label} : acompte de ${fmt(d['Payé'])} non repris (un devis ne se règle pas) — à enregistrer sur la facture correspondante`)
    }
    const id = await create({ type: 'DEV', src: d, label, party, date: d.Date, due: d['Échéance'], lines, notes, reference: txt(d['Numéro']), target, origStatus: st })
    if (!id) continue
    if (target === 'annule') toCancel.push({ id, label })
    else if (target === 'valide' && d['Numéro'] && !devisId.has(d['Numéro'])) devisId.set(d['Numéro'], id)
  }
  log(`Devis : ${JSON.stringify(report.documents.DEV ?? {})}`)

  // ── Factures ──
  for (const f of chrono(data.factures)) {
    const label = `Facture ${f['Numéro']} du ${f.Date} — ${f.Client}`
    const party = await clientOf(f, label)
    if (!party) continue
    const st = f.Statut
    const target = st === 'validee' || st === 'payee' ? 'valide' : 'brouillon'
    const lines = buildLines(f, detailOf('Facture', f), { amount: Number(f['Montant TTC']) || 0, label: f['Numéro'] })
    const reference = `${st === 'annulee' ? 'ANNULÉE ' : ''}${txt(f['Numéro'])}`
    const id = await create({ type: 'FAC', src: f, label, party, date: f.Date, due: f['Échéance'], lines, notes: [...lines.notes], reference, target, origStatus: st, sourceId: target === 'valide' ? devisId.get(f["Proforma d'origine"]) : undefined })
    if (!id) continue
    if (st === 'annulee') report.aVerifier.push(`${label} : annulée dans l'ancien système — reprise en brouillon « ANNULÉE », à supprimer si elle n'a plus d'utilité`)
    if (/doublon/.test(f.Anomalies ?? '') && target === 'valide') report.aVerifier.push(`${label} : doublon probable signalé — reprise telle quelle (${fmt(f['Montant TTC'])})`)
    if (st === 'payee' && id > 0) {
      const ttc = Number(f['Montant TTC']) || 0
      const paid = Number(f['Payé']) > 0 ? Number(f['Payé']) : ttc
      const guessed = !(Number(f['Payé']) > 0)
      try {
        await rpc('payments.add', { document_id: id, amount: Math.min(paid, ttc), date: f.Date, method: 'Autre', reference: txt(f['Numéro']), note: "Règlement repris de l'ancien système (date et mode à vérifier)" })
        report.reglements.push(`${label} : ${fmt(Math.min(paid, ttc))}`)
        if (guessed) report.aVerifier.push(`${label} : marquée payée sans règlement enregistré — règlement de ${fmt(ttc)} créé d'après le statut, à confirmer`)
      } catch (e) {
        report.erreurs.push(`${label} (règlement) : ${e.message}`)
      }
    } else if (st === 'payee') report.reglements.push(`${label} : ${fmt(f['Payé'] || f['Montant TTC'])}`)
  }
  log(`Factures : ${JSON.stringify(report.documents.FAC ?? {})}, ${report.reglements.length} règlement(s)`)

  // ── Bons de livraison ──
  for (const b of chrono(data.bons_livraison)) {
    const label = `${b.Type === 'enlevement' ? "Bon d'enlèvement" : 'Bon de livraison'} ${b['Numéro']} du ${b.Date} — ${b.Client}`
    if (b.Type === 'enlevement') {
      report.nonRepris.push(label)
      continue
    }
    const party = await clientOf(b, label)
    if (!party) continue
    // Mêmes articles que la facture liée : on reprend ses lignes (avec les prix)
    const inv = (data.factures ?? []).find((f) => f['Numéro'] && f['Numéro'] === b['Facture liée'])
    let det = inv ? detailOf('Facture', inv) : undefined
    if (!det && txt(b.Articles)) {
      det = txt(b.Articles).split(';').map((a) => /^(.*?)\s*×\s*([\d.,]+)$/.exec(a.trim())).filter((m) => m && m[1].trim()).map((m) => ({ 'Désignation': m[1].trim(), 'Quantité': Number(m[2].replace(',', '.')) || 1, 'Prix unitaire': 0 }))
    }
    const lines = buildLines({ 'Montant HT': 0, TVA: 0, 'Montant TTC': 0 }, det, { label: b['Numéro'] })
    lines.ecart = 0
    const reference = [txt(b['Numéro']), b['Facture liée'] && `facture ${b['Facture liée']}`].filter(Boolean).join(' — ')
    await create({ type: 'BL', src: b, label, party, date: b.Date, lines, notes: [], reference, target: b.Statut === 'valide' ? 'valide' : 'brouillon', origStatus: b.Statut })
  }
  log(`Bons de livraison : ${JSON.stringify(report.documents.BL ?? {})}, ${report.nonRepris.length} bon(s) d'enlèvement non repris`)

  // ── Bons de commande fournisseurs ──
  for (const c of chrono(data.bons_commande)) {
    const label = `Bon de commande ${c['Numéro']} du ${c['Date commande']} — ${c.Fournisseur}`
    if (!txt(c.Fournisseur)) {
      report.erreurs.push(`${label} : fournisseur absent`)
      continue
    }
    const party = await ensureParty('supplier', { name: txt(c.Fournisseur) })
    const total = Number(c['Montant total']) || 0
    const lines = buildLines({ 'Montant HT': total, TVA: 0, 'Montant TTC': total }, undefined, { amount: total, label: c['Numéro'] })
    await create({ type: 'BC', src: c, label, party, date: c['Date commande'], lines, notes: [], reference: txt(c['Numéro']), target: c.Statut === 'validee' ? 'valide' : 'brouillon', origStatus: c.Statut })
  }

  // ── Devis annulés ──
  for (const d of toCancel) {
    if (dryRun) continue
    try {
      await rpc('documents.cancel', { id: d.id })
      report.documents.DEV.valide--
      report.documents.DEV.annule++
    } catch (e) {
      report.erreurs.push(`${d.label} (annulation) : ${e.message}`)
    }
  }
  return report
}

export function printReport(r, out = console.log) {
  out('\n══ Compte rendu de la reprise ══')
  out(`Clients : ${r.clients.crees} créés${r.clients.existants ? `, ${r.clients.existants} déjà présents` : ''} · Fournisseurs : ${r.fournisseurs}`)
  for (const [type, s] of Object.entries(r.documents)) out(`${type} : ${s.valide} validé(s), ${s.brouillon} brouillon(s), ${s.annule} annulé(s)`)
  out(`Règlements : ${r.reglements.length}`)
  const section = (title, list) => {
    if (!list.length) return
    out(`\n${title} (${list.length})`)
    for (const l of list) out(`  - ${l}`)
  }
  section('Fiches clients fusionnées', r.clients.fusionnes)
  section('À vérifier', r.aVerifier)
  section('Écarts de montant', r.ecarts)
  section('Non repris', r.nonRepris)
  section('Erreurs', r.erreurs)
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined)
  const die = (m) => (console.error(`Erreur : ${m}`), process.exit(1))
  const url = (opt('url') ?? '').replace(/\/+$/, '')
  const username = opt('user')
  const file = opt('file')
  const dryRun = args.includes('--dry-run')
  if (!file || (!dryRun && (!url || !username))) die('usage : node tools/import/reprise.mjs --url https://domaine/t/societe --user identifiant --file export.json [--dry-run] [--force]')
  const data = JSON.parse(readFileSync(file, 'utf8'))

  const finish = (report, what) => {
    if (what === 'articles') {
      console.log(`\n══ Articles : ${report.crees} créés (${report.produits} produits, ${report.prestations} prestations), ${report.existants} déjà présents ══`)
      for (const [t, l] of [['À vérifier', report.aVerifier], ['Erreurs', report.erreurs]]) if (l.length) console.log(`\n${t} (${l.length})\n` + l.map((x) => '  - ' + x).join('\n'))
    } else printReport(report)
    const out = opt('report') ?? file.replace(/\.json$/i, '') + `-compte-rendu${dryRun ? '-simulation' : ''}.json`
    writeFileSync(out, JSON.stringify(report, null, 2))
    console.log(`\nCompte rendu enregistré : ${out}`)
    if (report.erreurs.length) process.exit(2)
  }
  let rpc = async () => []
  if (!dryRun) {
    let password = process.env.IAM_PASSWORD
    if (!password) {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      password = await new Promise((res) => rl.question(`Mot de passe de ${username} : `, (a) => (rl.close(), res(a))))
    }
    const post = async (path, body, token) => {
      const res = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      return json.data
    }
    const { token } = await post('/api/login', { username, password, device: 'Reprise de historique' }).catch((e) => die(`connexion impossible : ${e.message}`))
    rpc = (name, a) => post('/api/call', { name, args: a }, token)

    if (Array.isArray(data)) return finish(await runProducts({ rpc, produits: data, log: console.log }), 'articles')
    const lic = await rpc('licence.status')
    if (lic.state !== 'active') die(`la base n'a pas de licence active (${lic.label}) : la reprise dépasserait les quantités de l'évaluation. Activez la licence puis relancez.`)
    const existing = await rpc('documents.list', { types: ['DEV', 'BL', 'FAC', 'AV'] })
    if (existing.length && !args.includes('--force')) die(`la base contient déjà ${existing.length} document(s) de vente : reprise déjà faite ? (--force pour continuer quand même, au risque de doublons)`)
  }

  if (Array.isArray(data)) return finish(await runProducts({ rpc, produits: data, dryRun, log: console.log }), 'articles')
  finish(await runReprise({ rpc, data, dryRun, log: (m) => console.log(m) }))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => (console.error(e), process.exit(1)))
