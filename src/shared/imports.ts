// Import de données depuis Excel ou CSV : définition des colonnes de chaque type,
// reconnaissance souple des en-têtes (accents, casse, synonymes) et lecture CSV.

import type { Module } from './domain'

export type ImportKind = 'clients' | 'suppliers' | 'products' | 'stock' | 'employees' | 'accounts'

export interface ImportColumn {
  key: string
  label: string
  /** Autres intitulés acceptés pour cette colonne. */
  aliases: string[]
  required?: boolean
  example: string
  hint?: string
}

export interface ImportDef {
  kind: ImportKind
  label: string
  description: string
  module: Module
  /** Colonne qui identifie une fiche existante (mise à jour au lieu d'un doublon). */
  match: string
  columns: ImportColumn[]
}

const partyColumns = (taxLabel: string): ImportColumn[] => [
  { key: 'code', label: 'Code', aliases: ['code client', 'code fournisseur', 'reference', 'ref'], example: '', hint: 'Automatique si vide' },
  { key: 'name', label: 'Nom', aliases: ['nom', 'raison sociale', 'societe', 'client', 'fournisseur', 'nom complet', 'denomination'], required: true, example: 'SONABEL' },
  { key: 'contact', label: 'Contact', aliases: ['interlocuteur', 'personne a contacter'], example: 'M. Ouédraogo' },
  { key: 'phone', label: 'Téléphone', aliases: ['tel', 'telephone', 'portable', 'mobile', 'gsm'], example: '+226 25 30 61 00' },
  { key: 'email', label: 'Email', aliases: ['e-mail', 'mail', 'courriel', 'adresse email'], example: 'contact@exemple.bf' },
  { key: 'address', label: 'Adresse', aliases: ['adresse postale', 'localisation'], example: 'Avenue de la Nation' },
  { key: 'city', label: 'Ville', aliases: ['localite', 'commune'], example: 'Ouagadougou' },
  { key: 'tax_id', label: taxLabel, aliases: ['ifu', 'nif', 'ncc', 'ninea', 'niu', 'identifiant fiscal', 'numero fiscal', 'n ifu', 'n nif'], example: '00012345A' },
  { key: 'rccm', label: 'RCCM', aliases: ['registre de commerce', 'rc'], example: 'BF-OUA-2020-B-1234' },
  { key: 'payment_terms', label: 'Délai de paiement', aliases: ['delai', 'delai de paiement (jours)', 'echeance', 'jours'], example: '30' },
  { key: 'notes', label: 'Notes', aliases: ['observations', 'commentaire', 'remarques'], example: '' }
]

export function importDefs(taxLabel = 'IFU'): ImportDef[] {
  return [
    { kind: 'clients', label: 'Clients', description: 'Fiches clients : coordonnées, identifiant fiscal, délai de paiement.', module: 'clients', match: 'code', columns: partyColumns(taxLabel) },
    { kind: 'suppliers', label: 'Fournisseurs', description: 'Fiches fournisseurs.', module: 'suppliers', match: 'code', columns: partyColumns(taxLabel).map((c) => (c.key === 'name' ? { ...c, example: 'CFAO Motors' } : c)) },
    {
      kind: 'products', label: 'Articles et prestations', description: 'Catalogue : prix, TVA, catégories, unités.', module: 'products', match: 'ref',
      columns: [
        { key: 'ref', label: 'Référence', aliases: ['ref', 'code', 'code article', 'sku'], example: '', hint: 'Automatique si vide' },
        { key: 'name', label: 'Désignation', aliases: ['designation', 'libelle', 'nom', 'article', 'produit', 'description courte'], required: true, example: 'Switch Cisco 24 ports' },
        { key: 'kind', label: 'Type', aliases: ['nature', 'produit ou prestation'], example: 'produit', hint: 'produit ou prestation' },
        { key: 'category', label: 'Catégorie', aliases: ['famille', 'rayon', 'categorie'], example: 'Réseau' },
        { key: 'unit', label: 'Unité', aliases: ['unite', 'conditionnement'], example: 'unité' },
        { key: 'sale_price', label: 'Prix de vente HT', aliases: ['prix de vente', 'pv', 'pv ht', 'prix', 'prix unitaire', 'prix ht'], example: '350000' },
        { key: 'purchase_price', label: "Prix d'achat HT", aliases: ['prix d achat', 'pa', 'pa ht', 'cout', 'cout d achat'], example: '240000' },
        { key: 'tva_rate', label: 'TVA (%)', aliases: ['tva', 'taux de tva', 'taux tva'], example: '18' },
        { key: 'min_stock', label: 'Stock minimum', aliases: ['seuil', 'stock mini', 'seuil d alerte', 'stock min'], example: '2' },
        { key: 'description', label: 'Description', aliases: ['description longue', 'details'], example: '' }
      ]
    },
    {
      kind: 'stock', label: 'Stock initial', description: 'Quantités en stock par article (reprise ou inventaire de départ).', module: 'stock', match: 'ref',
      columns: [
        { key: 'ref', label: 'Référence', aliases: ['ref', 'code', 'code article'], required: true, example: 'ART-0001' },
        { key: 'quantity', label: 'Quantité', aliases: ['qte', 'quantite', 'stock', 'quantite en stock'], required: true, example: '10' },
        { key: 'unit_cost', label: 'Coût unitaire', aliases: ['cout', 'cout unitaire', 'prix d achat', 'pa', 'valeur unitaire'], example: '240000' },
        { key: 'warehouse', label: 'Dépôt', aliases: ['depot', 'magasin', 'entrepot', 'code depot'], example: 'PRINCIPAL', hint: 'Code du dépôt' }
      ]
    },
    {
      kind: 'employees', label: 'Salariés', description: 'Personnel : emploi, salaire, indemnités, charges de famille.', module: 'hr', match: 'matricule',
      columns: [
        { key: 'matricule', label: 'Matricule', aliases: ['mat', 'numero', 'id'], example: '', hint: 'Automatique si vide' },
        { key: 'first_name', label: 'Prénom', aliases: ['prenom', 'prenoms'], required: true, example: 'Issa' },
        { key: 'last_name', label: 'Nom', aliases: ['nom de famille'], required: true, example: 'Compaoré' },
        { key: 'job', label: 'Emploi', aliases: ['poste', 'fonction', 'emploi occupe'], example: 'Technicien réseau' },
        { key: 'department', label: 'Service', aliases: ['departement', 'direction'], example: 'Technique' },
        { key: 'category', label: 'Catégorie', aliases: ['categorie', 'statut'], example: 'non_cadre', hint: 'cadre ou non_cadre' },
        { key: 'hire_date', label: "Date d'embauche", aliases: ['embauche', 'date embauche', 'date d entree', 'entree'], required: true, example: '2024-01-15', hint: 'AAAA-MM-JJ ou JJ/MM/AAAA' },
        { key: 'base_salary', label: 'Salaire de base', aliases: ['salaire', 'salaire brut de base', 'sbase'], required: true, example: '200000' },
        { key: 'housing', label: 'Indemnité de logement', aliases: ['logement'], example: '50000' },
        { key: 'transport', label: 'Indemnité de transport', aliases: ['transport'], example: '20000' },
        { key: 'family_charges', label: 'Charges de famille', aliases: ['enfants', 'personnes a charge', 'charges'], example: '2' },
        { key: 'cnss_number', label: 'N° sécurité sociale', aliases: ['cnss', 'n cnss', 'numero cnss', 'cnps', 'ipres'], example: '' },
        { key: 'phone', label: 'Téléphone', aliases: ['tel', 'telephone', 'portable'], example: '' },
        { key: 'email', label: 'Email', aliases: ['e-mail', 'mail'], example: '' },
        { key: 'bank_account', label: 'Compte bancaire', aliases: ['rib', 'iban', 'compte'], example: '' }
      ]
    },
    {
      kind: 'accounts', label: 'Plan comptable', description: 'Comptes complémentaires (numéro et intitulé).', module: 'accounting', match: 'number',
      columns: [
        { key: 'number', label: 'Numéro', aliases: ['compte', 'n compte', 'numero de compte'], required: true, example: '6241' },
        { key: 'label', label: 'Intitulé', aliases: ['libelle', 'intitule du compte', 'nom'], required: true, example: 'Transports sur achats' }
      ]
    }
  ]
}

/** Intitulé normalisé : minuscules, sans accents ni ponctuation. */
export function normalizeHeader(h: string): string {
  return String(h ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[°º'’`".()\[\]:*_/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Associe chaque colonne du fichier à un champ (ou null si ignorée). */
export function mapHeaders(headers: string[], def: ImportDef): (string | null)[] {
  const used = new Set<string>()
  return headers.map((h) => {
    const n = normalizeHeader(h)
    if (!n) return null
    const col = def.columns.find((c) => !used.has(c.key) && (normalizeHeader(c.label) === n || c.key === n || c.aliases.some((a) => normalizeHeader(a) === n)))
    if (!col) return null
    used.add(col.key)
    return col.key
  })
}

/** Lecture CSV : séparateur détecté (; , tabulation), guillemets, BOM, fins de ligne Windows. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const count = (ch: string) => firstLine.split(ch).length - 1
  const sep = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === sep) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim() !== ''))
}

/** Lignes du fichier → objets { champ: valeur } selon la correspondance des colonnes. */
export function rowsToRecords(table: string[][], mapping: (string | null)[]): Record<string, string>[] {
  return table.slice(1).map((r) => {
    const o: Record<string, string> = {}
    mapping.forEach((key, i) => {
      if (key) o[key] = String(r[i] ?? '').trim()
    })
    return o
  })
}

/** Modèle CSV (séparateur « ; » pour Excel en français) avec une ligne d'exemple. */
export function templateCsv(def: ImportDef): string {
  const q = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return '﻿' + [def.columns.map((c) => q(c.label)).join(';'), def.columns.map((c) => q(c.example)).join(';')].join('\r\n') + '\r\n'
}
