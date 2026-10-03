#!/usr/bin/env node
// Émission d'une licence IAM INVOICER (réservé à l'éditeur).
//
//   node tools/licence/issue.mjs --client "Pharmacie du Progrès SARL" --tier pro --months 12
//   node tools/licence/issue.mjs --client "SONABEL" --ifu 00012345A --tier entreprise --perpetual
//   node tools/licence/issue.mjs --client "Boutique X" --tier sur-mesure --modules sales,clients,products,cash --users 3 --until 2027-06-30
//
// Options : --users N (sinon celui du palier), --white-label, --id LIC-…,
//           --key chemin/vers/licence-private.pem (défaut : ~/.iam-invoicer/licence-private.pem)
// Chaque licence émise est ajoutée au registre ~/.iam-invoicer/licences.csv.

import { createPrivateKey, sign } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MODULE_NAMES, TIERS } from '../../src/shared/licence.ts'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const flag = (name) => args.includes(`--${name}`)
const die = (msg) => {
  console.error(`Erreur : ${msg}`)
  process.exit(1)
}

const client = opt('client')
const tier = opt('tier') ?? 'pro'
if (!client) die('--client "Raison sociale" est obligatoire (exactement comme configurée chez le client).')
if (!['essentiel', 'pro', 'entreprise', 'sur-mesure'].includes(tier)) die('--tier : essentiel, pro, entreprise ou sur-mesure.')

let modules
if (tier === 'sur-mesure') {
  const list = (opt('modules') ?? '').split(',').map((m) => m.trim()).filter(Boolean)
  const unknown = list.filter((m) => !(m in MODULE_NAMES))
  if (!list.length) die('--modules obligatoire pour une licence sur mesure (ex. sales,clients,products,cash).')
  if (unknown.length) die(`modules inconnus : ${unknown.join(', ')}. Disponibles : ${Object.keys(MODULE_NAMES).join(', ')}`)
  modules = list
} else modules = TIERS[tier].modules

const users = opt('users') !== undefined ? Number(opt('users')) : tier === 'sur-mesure' ? 3 : TIERS[tier].users
if (!Number.isInteger(users) || users < 0) die('--users : nombre entier (0 = illimité).')

const today = new Date().toISOString().slice(0, 10)
let expires = null
if (opt('until')) {
  expires = opt('until')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) die('--until AAAA-MM-JJ')
} else if (!flag('perpetual')) {
  const d = new Date()
  d.setMonth(d.getMonth() + Number(opt('months') ?? 12))
  expires = d.toISOString().slice(0, 10)
}

const dir = join(homedir(), '.iam-invoicer')
const keyPath = opt('key') ?? join(dir, 'licence-private.pem')
if (!existsSync(keyPath)) die(`clé privée introuvable : ${keyPath}`)
const registry = join(dir, 'licences.csv')
if (!existsSync(registry)) writeFileSync(registry, '﻿Numéro;Date;Client;IFU;Palier;Utilisateurs;Expire;Marque blanche;Licence\r\n')
const count = readFileSync(registry, 'utf8').trim().split(/\r?\n/).length // en-tête compris
const id = opt('id') ?? `LIC-${today.slice(0, 4)}-${String(count).padStart(4, '0')}`

const payload = {
  v: 1,
  id,
  company: client,
  ...(opt('ifu') ? { taxId: opt('ifu') } : {}),
  tier,
  modules,
  users,
  issued: today,
  expires,
  whiteLabel: flag('white-label') || (tier !== 'sur-mesure' && TIERS[tier].whiteLabel)
}
const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
const signature = sign(null, Buffer.from(data), createPrivateKey(readFileSync(keyPath))).toString('base64url')
const licence = `${data}.${signature}`

appendFileSync(registry, [id, today, `"${client.replace(/"/g, '""')}"`, payload.taxId ?? '', tier, users || 'illimité', expires ?? 'perpétuelle', payload.whiteLabel ? 'oui' : 'non', licence].join(';') + '\r\n')

console.log(`\nLicence ${id} — ${client}`)
console.log(`Palier : ${tier} · ${users || 'illimité'} utilisateur(s) · ${expires ? `jusqu'au ${expires}` : 'perpétuelle'}${payload.whiteLabel ? ' · marque blanche' : ''}`)
console.log(`Modules : ${modules.map((m) => MODULE_NAMES[m]).join(', ')}`)
console.log('\nClé à transmettre au client (Société & paramètres → Licence) :\n')
console.log(licence)
console.log(`\nAjoutée au registre : ${registry}\n`)
