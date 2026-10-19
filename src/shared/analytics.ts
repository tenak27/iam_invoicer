// Analyses (informatique décisionnelle) : catalogue partagé entre le moteur (processus principal,
// serveur) et l'interface. Chaque jeu de données expose des dimensions (axes d'analyse) et des
// mesures (montants, quantités, ratios). Une analyse = jeu + mesures + regroupement + période.

import type { Module } from './domain'

export type MeasureFormat = 'money' | 'number' | 'percent' | 'count' | 'days'
export type TimeGrain = 'jour' | 'semaine' | 'mois' | 'trimestre' | 'annee'

export interface MeasureDef {
  id: string
  label: string
  format: MeasureFormat
  /** Mesure additive (somme des lignes = total) : permet le regroupement « Autres ». */
  additive: boolean
  hint?: string
}
export interface DimensionDef {
  id: string
  label: string
  /** Dimension temporelle : regroupement par jour, semaine, mois… */
  time?: boolean
}
export interface DatasetDef {
  id: string
  label: string
  description: string
  module: Module
  /** Photographie à date (créances, stock) : pas de filtre de période. */
  snapshot?: boolean
  measures: MeasureDef[]
  dimensions: DimensionDef[]
}

const PERIODE: DimensionDef = { id: 'periode', label: 'Période', time: true }

export const DATASETS: DatasetDef[] = [
  {
    id: 'ventes',
    label: 'Ventes',
    description: 'Factures et avoirs validés, ligne par ligne (avoirs déduits).',
    module: 'sales',
    measures: [
      { id: 'ca_ht', label: 'Chiffre d’affaires HT', format: 'money', additive: true },
      { id: 'marge', label: 'Marge estimée', format: 'money', additive: true, hint: 'CA HT moins coût moyen pondéré (ou prix d’achat) des articles vendus.' },
      { id: 'taux_marge', label: 'Taux de marge', format: 'percent', additive: false },
      { id: 'quantite', label: 'Quantités vendues', format: 'number', additive: true },
      { id: 'documents', label: 'Nombre de factures', format: 'count', additive: false },
      { id: 'panier', label: 'Panier moyen HT', format: 'money', additive: false },
      { id: 'clients', label: 'Clients distincts', format: 'count', additive: false }
    ],
    dimensions: [
      PERIODE,
      { id: 'client', label: 'Client' },
      { id: 'ville', label: 'Ville du client' },
      { id: 'article', label: 'Article' },
      { id: 'categorie', label: 'Catégorie d’article' },
      { id: 'type_article', label: 'Produit ou prestation' },
      { id: 'commercial', label: 'Vendeur' },
      { id: 'projet', label: 'Projet' },
      { id: 'depot', label: 'Dépôt' },
      { id: 'jour_semaine', label: 'Jour de la semaine' }
    ]
  },
  {
    id: 'achats',
    label: 'Achats',
    description: 'Factures fournisseurs validées, ligne par ligne.',
    module: 'purchases',
    measures: [
      { id: 'montant_ht', label: 'Achats HT', format: 'money', additive: true },
      { id: 'quantite', label: 'Quantités achetées', format: 'number', additive: true },
      { id: 'documents', label: 'Nombre de factures', format: 'count', additive: false },
      { id: 'fournisseurs', label: 'Fournisseurs distincts', format: 'count', additive: false },
      { id: 'prix_moyen', label: 'Prix d’achat moyen', format: 'money', additive: false }
    ],
    dimensions: [
      PERIODE,
      { id: 'fournisseur', label: 'Fournisseur' },
      { id: 'article', label: 'Article' },
      { id: 'categorie', label: 'Catégorie d’article' },
      { id: 'ville', label: 'Ville du fournisseur' },
      { id: 'projet', label: 'Projet' }
    ]
  },
  {
    id: 'tresorerie',
    label: 'Encaissements et décaissements',
    description: 'Règlements reçus et versés, par mode de paiement.',
    module: 'payments',
    measures: [
      { id: 'entrees', label: 'Encaissements', format: 'money', additive: true },
      { id: 'sorties', label: 'Décaissements', format: 'money', additive: true },
      { id: 'solde', label: 'Solde (entrées − sorties)', format: 'money', additive: true },
      { id: 'operations', label: 'Nombre d’opérations', format: 'count', additive: true }
    ],
    dimensions: [
      PERIODE,
      { id: 'mode', label: 'Mode de règlement' },
      { id: 'sens', label: 'Sens' },
      { id: 'tiers', label: 'Client ou fournisseur' },
      { id: 'utilisateur', label: 'Saisi par' }
    ]
  },
  {
    id: 'creances',
    label: 'Créances clients',
    description: 'Factures non soldées à ce jour, par ancienneté.',
    module: 'sales',
    snapshot: true,
    measures: [
      { id: 'reste_du', label: 'Reste à encaisser', format: 'money', additive: true },
      { id: 'factures', label: 'Factures ouvertes', format: 'count', additive: true },
      { id: 'retard_moyen', label: 'Retard moyen', format: 'days', additive: false },
      { id: 'clients', label: 'Clients concernés', format: 'count', additive: false }
    ],
    dimensions: [
      { id: 'anciennete', label: 'Ancienneté (échéance)' },
      { id: 'client', label: 'Client' },
      { id: 'ville', label: 'Ville du client' },
      { id: 'commercial', label: 'Vendeur' },
      { id: 'periode', label: 'Date de facture', time: true }
    ]
  },
  {
    id: 'stock',
    label: 'Stock',
    description: 'Articles stockés à ce jour : quantités et valeur.',
    module: 'stock',
    snapshot: true,
    measures: [
      { id: 'valeur', label: 'Valeur du stock (coût)', format: 'money', additive: true },
      { id: 'valeur_vente', label: 'Valeur au prix de vente', format: 'money', additive: true },
      { id: 'quantite', label: 'Quantité en stock', format: 'number', additive: true },
      { id: 'articles', label: 'Nombre d’articles', format: 'count', additive: true },
      { id: 'sous_seuil', label: 'Articles sous le seuil', format: 'count', additive: true }
    ],
    dimensions: [
      { id: 'categorie', label: 'Catégorie' },
      { id: 'article', label: 'Article' },
      { id: 'alerte', label: 'Niveau de stock' }
    ]
  },
  {
    id: 'caisse',
    label: 'Caisse',
    description: 'Ventes enregistrées au point de vente (tickets).',
    module: 'cash',
    measures: [
      { id: 'ca_ttc', label: 'Ventes TTC', format: 'money', additive: true },
      { id: 'tickets', label: 'Nombre de tickets', format: 'count', additive: true },
      { id: 'ticket_moyen', label: 'Ticket moyen', format: 'money', additive: false }
    ],
    dimensions: [
      PERIODE,
      { id: 'caissier', label: 'Caissier' },
      { id: 'heure', label: 'Heure de la journée' },
      { id: 'jour_semaine', label: 'Jour de la semaine' }
    ]
  }
]

export type Compare = 'none' | 'previous' | 'year'
export type ChartKind = 'bar' | 'line' | 'area' | 'donut' | 'hbar' | 'stacked' | 'table'

export interface AnalysisConfig {
  dataset: string
  measures: string[]
  /** Regroupement des lignes (une dimension) ; vide = total seul. */
  rows?: string
  /** Colonnes du tableau croisé (deuxième dimension, facultative). */
  columns?: string
  grain?: TimeGrain
  from?: string
  to?: string
  compare?: Compare
  /** Filtres : dimension → valeurs retenues. */
  filters?: Record<string, string[]>
  /** Nombre de lignes affichées (les suivantes sont regroupées en « Autres »). */
  top?: number
  sort?: 'value' | 'label'
  chart?: ChartKind
}

export interface AnalysisRow {
  key: string
  label: string
  values: Record<string, number | null>
  compare?: Record<string, number | null>
  /** Tableau croisé : colonne → mesure → valeur (première mesure). */
  cells?: Record<string, number | null>
}
export interface Insight { tone: 'good' | 'bad' | 'info'; text: string }
export interface AnalysisResult {
  dataset: string
  from: string | null
  to: string | null
  compareFrom: string | null
  compareTo: string | null
  rows: AnalysisRow[]
  columns: string[]
  totals: Record<string, number | null>
  compareTotals: Record<string, number | null> | null
  forecast: { key: string; label: string; value: number }[]
  insights: Insight[]
  truncated: boolean
}

export interface AlertRule { measure: string; op: '<' | '>'; threshold: number }

export const findDataset = (id: string) => DATASETS.find((d) => d.id === id)

