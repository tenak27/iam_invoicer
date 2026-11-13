// Outils MCP d'IAM INVOICER (serveur commun : tools/socle/server/mcp.ts, adresse POST /api/mcp).
// Chaque outil est un appel du routeur (src/main/router.ts), ouvert aux assistants (Claude, ChatGPT,
// Cursor…) avec la clé d'API de la société : mêmes droits et mêmes limites que /api/v1. Une clé en
// lecture seule ne voit que les consultations (règle `read` de integrations.ts) ; rien de ce que
// `forbidden` exclut n'est proposé (licences, exercices, envois de messages, signatures, imports).
// Les arguments décrits ici sont ceux que lisent les services de src/main/services.
import { DOC_TYPES, PAYMENT_METHODS } from '@shared/domain'
import { EXPENSE_CATEGORIES as PROJECT_EXPENSES } from '@shared/projects'
import { EXPENSE_CATEGORIES, REQUEST_STATUS } from '@shared/workflow'
import type { McpArg, McpTool } from '../../tools/socle/server/mcp'

type Extra = Partial<Omit<McpArg, 'type' | 'description'>>
const text = (description: string, extra: Extra = {}): McpArg => ({ type: 'string', description, ...extra })
const int = (description: string, extra: Extra = {}): McpArg => ({ type: 'integer', description, ...extra })
const amount = (description: string, extra: Extra = {}): McpArg => ({ type: 'number', description, ...extra })
const bool = (description: string, extra: Extra = {}): McpArg => ({ type: 'boolean', description, ...extra })
const REQ = { required: true } as const

const DOC_CODES = Object.keys(DOC_TYPES)
const TYPES = 'DEV devis, BL bon de livraison, FAC facture, AV avoir (ventes) ; BC bon de commande, BR bon de réception, FF facture fournisseur (achats)'
const METHODS = [...PAYMENT_METHODS]
const STAGES = ['nouveau', 'qualifie', 'proposition', 'negociation', 'gagne', 'perdu']
const PROJECT_STATUS = ['prospect', 'en_cours', 'suspendu', 'termine', 'annule']
const TASK_STATUS = ['a_faire', 'en_cours', 'bloque', 'termine']
const from = text('Date de début incluse, AAAA-MM-JJ')
const to = text('Date de fin incluse, AAAA-MM-JJ')
const FULL = 'En modification, renvoyez tous les champs de la fiche : un champ omis est vidé ou remis à zéro.'

/** Lignes d'un document (devis, facture, vente au comptoir). */
const LINES = {
  type: 'object',
  properties: {
    product_id: { type: 'integer', description: 'Article du catalogue (products_list) ; absent pour une ligne libre' },
    description: { type: 'string', description: 'Désignation, obligatoire même avec product_id' },
    quantity: { type: 'number', description: 'Quantité, supérieure à zéro' },
    unit_price: { type: 'number', description: 'Prix unitaire hors taxes, en francs CFA' },
    discount: { type: 'number', description: 'Remise en pourcentage, de 0 à 100' },
    tva_rate: { type: 'number', description: 'Taux de TVA en pourcentage (18 au Burkina Faso, 0 si exonéré)' },
    lot_refs: { type: 'string', description: 'Lot, ou numéros de série séparés par des virgules, pour un article suivi' }
  },
  required: ['description', 'quantity', 'unit_price']
}

export const MCP_TOOLS: McpTool[] = [
  // ── Clients et fournisseurs ──
  {
    call: 'parties.list',
    title: 'Liste des clients ou des fournisseurs',
    description: 'Fiches des clients ou des fournisseurs avec leur solde (ce que le client doit, ou ce qui est dû au fournisseur). Renvoie un tableau {id, code, name, contact, phone, email, city, tax_id, payment_terms, is_prospect, active, balance}.',
    args: {
      kind: text('client ou supplier (fournisseur)', { ...REQ, enum: ['client', 'supplier'] }),
      search: text('Texte cherché dans le nom, le code, le téléphone ou le contact'),
      includeInactive: bool('Vrai : inclure les fiches désactivées'),
      prospect: text('Clients seulement : prospect = prospects, client = clients établis ; absent = tous', { enum: ['prospect', 'client'] })
    }
  },
  {
    call: 'parties.get',
    title: 'Fiche d’un client ou d’un fournisseur',
    description: 'Fiche complète d’un tiers, ses 200 derniers documents (avec le montant déjà payé) et ses 200 derniers paiements. Renvoie {party, documents, payments}.',
    args: { id: int('Numéro du tiers (id de parties_list)', REQ) }
  },
  {
    call: 'parties.options',
    title: 'Clients ou fournisseurs à choisir',
    description: 'Liste courte des tiers actifs, pour choisir le party_id d’un document. Renvoie un tableau {id, code, name, payment_terms}.',
    args: { kind: text('client ou supplier (fournisseur)', { ...REQ, enum: ['client', 'supplier'] }) }
  },
  {
    call: 'parties.save',
    title: 'Créer ou modifier un client ou un fournisseur',
    description: `Enregistre la fiche d’un tiers. id : absent pour créer, présent pour modifier. ${FULL} Renvoie {id}.`,
    args: {
      id: int('Numéro du tiers à modifier ; absent pour créer'),
      kind: text('client (par défaut) ou supplier ; en modification, le même que celui de la fiche', { enum: ['client', 'supplier'] }),
      name: text('Nom ou raison sociale', REQ),
      code: text('Code de la fiche, à la création seulement ; absent : CLI-0001 ou FRS-0001 attribué'),
      contact: text('Nom de l’interlocuteur'),
      phone: text('Téléphone'),
      email: text('Adresse e-mail'),
      address: text('Adresse'),
      city: text('Ville'),
      tax_id: text('Numéro IFU'),
      rccm: text('Numéro RCCM'),
      payment_terms: int('Délai de paiement en jours (0 = comptant)'),
      notes: text('Notes internes'),
      active: bool('Faux pour désactiver la fiche (vrai par défaut)'),
      is_prospect: bool('Client seulement : vrai pour un prospect'),
      source: text('Origine du prospect (salon, recommandation, site web…)')
    }
  },

  // ── Catalogue ──
  {
    call: 'products.list',
    title: 'Catalogue des articles',
    description: 'Produits stockés et prestations de service. Renvoie un tableau {id, ref, name, kind, category, unit, sale_price, purchase_price, tva_rate, stock_qty, min_stock, avg_cost, stock_value, active}. Prix hors taxes en francs CFA.',
    args: {
      search: text('Texte cherché dans la désignation, la référence ou la catégorie'),
      kind: text('produit (stocké) ou prestation ; absent = tous', { enum: ['produit', 'prestation'] }),
      includeInactive: bool('Vrai : inclure les articles désactivés'),
      lowStock: bool('Vrai : seulement les produits au seuil d’alerte ou en dessous')
    }
  },
  { call: 'products.categories', title: 'Catégories d’articles', description: 'Catégories utilisées dans le catalogue. Renvoie un tableau de textes.' },
  {
    call: 'products.save',
    title: 'Créer ou modifier un article',
    description: `Enregistre un produit ou une prestation. id : absent pour créer, présent pour modifier. ${FULL} Le stock ne se change pas ici (stock_adjust). Renvoie {id}.`,
    args: {
      id: int('Numéro de l’article à modifier ; absent pour créer'),
      kind: text('produit (stocké, par défaut) ou prestation', { enum: ['produit', 'prestation'] }),
      name: text('Désignation', REQ),
      ref: text('Référence, à la création seulement ; absente : ART-0001 ou PRE-0001 attribuée'),
      description: text('Description'),
      category: text('Catégorie'),
      unit: text('Unité (unité, kg, heure, forfait…)'),
      sale_price: amount('Prix de vente hors taxes, en francs CFA'),
      purchase_price: amount('Prix d’achat hors taxes, en francs CFA'),
      tva_rate: amount('Taux de TVA en pourcentage, de 0 à 100'),
      min_stock: amount('Seuil d’alerte de stock (produit)'),
      tracking: text('Suivi du stock : aucun, lot ou serie (numéros de série)', { enum: ['aucun', 'lot', 'serie'] }),
      active: bool('Faux pour désactiver l’article (vrai par défaut)'),
      shop: bool('Vrai : publié dans la boutique en ligne'),
      showcase: bool('Vrai : mis en avant sur le site de la société')
    }
  },

  // ── Documents : devis, factures, avoirs, commandes ──
  {
    call: 'documents.list',
    title: 'Liste des documents',
    description: 'Devis, factures, avoirs, bons et factures fournisseurs, du plus récent au plus ancien (1 000 au plus). Renvoie un tableau {id, type, number, status, date, due_date, reference, total_ht, total_tva, total_ttc, party_id, party_name, paid}. Reste à payer = total_ttc − paid.',
    args: {
      types: { type: 'array', description: `Types voulus, d’un seul côté (ventes ou achats) : ${TYPES}. Exemple : ["FAC"]`, required: true, items: { type: 'string', enum: DOC_CODES } },
      search: text('Texte cherché dans le numéro, le nom du tiers ou la référence'),
      status: text('brouillon, valide ou annule ; absent = tous', { enum: ['brouillon', 'valide', 'annule'] }),
      from,
      to,
      partyId: int('Seulement les documents de ce tiers'),
      unpaidOnly: bool('Vrai : seulement les documents validés qui restent à régler')
    }
  },
  {
    call: 'documents.get',
    title: 'Détail d’un document',
    description: 'Document complet : en-tête, tiers, lignes, taxes, paiements reçus et documents qui en sont issus. Renvoie {id, type, number, status, date, total_ttc, paid, party, lines, payments, children…}.',
    args: { id: int('Numéro du document (id de documents_list)', REQ) }
  },
  {
    call: 'documents.searchDesignations',
    title: 'Désignations déjà facturées',
    description: 'Lignes libres déjà saisies sur les documents du même côté (ventes ou achats), avec leur dernier prix. Renvoie 8 résultats au plus {description, uses, last_date, unit_price, tva_rate}.',
    args: {
      type: text(`Type de document qui fixe le côté : ${TYPES}`, { ...REQ, enum: DOC_CODES }),
      q: text('Mots cherchés (2 lettres au moins par mot)', REQ)
    }
  },
  {
    call: 'documents.save',
    title: 'Créer ou modifier un document',
    description: 'Enregistre un devis, une facture, un avoir, un bon ou une facture fournisseur en brouillon ; avec validate, le valide aussitôt (numéro attribué, stock et comptabilité mis à jour). id : absent pour créer, présent pour modifier un brouillon (les lignes envoyées remplacent les anciennes). Renvoie {id, validated?, error?} : si la validation est refusée, le brouillon reste enregistré et error en donne le motif.',
    args: {
      id: int('Numéro du brouillon à modifier ; absent pour créer'),
      type: text(`Type, obligatoire à la création : ${TYPES}`, { enum: DOC_CODES }),
      party_id: int('Client (ventes) ou fournisseur (achats) : id de parties_list', REQ),
      date: text('Date du document, AAAA-MM-JJ ; absente : aujourd’hui'),
      due_date: text('Échéance, AAAA-MM-JJ ; absente : date + délai de paiement du tiers'),
      reference: text('Référence libre (bon de commande du client…)'),
      notes: text('Notes imprimées sur le document'),
      lines: { type: 'array', description: 'Lignes du document ; une au moins pour valider', required: true, items: LINES },
      taxes: { type: 'array', description: 'Codes des taxes à appliquer (taxes_list), [] pour aucune ; absent : taxes automatiques à la création, taxes inchangées en modification', items: { type: 'string' } },
      warehouse_id: int('Dépôt concerné (stock_warehouses) ; absent : dépôt principal'),
      project_id: int('Projet rattaché (projects_list)'),
      validate: bool('Vrai : valider aussitôt après l’enregistrement'),
      applyStock: bool('Avoir validé : faux pour ne pas remettre les articles en stock')
    }
  },
  {
    call: 'documents.validate',
    title: 'Valider un document',
    description: 'Valide un brouillon : numéro définitif, mouvements de stock, écriture comptable. Une facture validée ne se modifie plus (elle se corrige par un avoir). Renvoie le document complet.',
    args: { id: int('Numéro du brouillon', REQ), applyStock: bool('Avoir : faux pour ne pas remettre les articles en stock') }
  },
  {
    call: 'documents.cancel',
    title: 'Annuler un document validé',
    description: 'Annule un document validé : stock et écriture comptable sont repris. Refusé s’il porte des paiements (payments_delete d’abord) ou s’il a été transformé en un document validé. Renvoie le document complet.',
    args: { id: int('Numéro du document validé', REQ) }
  },
  { call: 'documents.delete', title: 'Supprimer un brouillon', description: 'Supprime définitivement un document en brouillon ; un document validé s’annule (documents_cancel). Renvoie true.', args: { id: int('Numéro du brouillon', REQ) } },
  {
    call: 'documents.convert',
    title: 'Transformer un document',
    description: 'Crée le document suivant à partir d’un document validé, en brouillon prérempli : devis → BL ou FAC, BL → FAC, FAC → AV (avoir), BC → BR ou FF, BR → FF. Si la transformation existe déjà, renvoie ce document. Renvoie {id, existing?, duplicata?, number?}.',
    args: { id: int('Numéro du document validé d’origine', REQ), to: text('Type du document à créer', { ...REQ, enum: DOC_CODES.filter((t) => t !== 'DEV' && t !== 'BC') }) }
  },
  { call: 'documents.duplicate', title: 'Dupliquer un document', description: 'Copie un document (mêmes tiers, lignes et taxes) en nouveau brouillon du même type, daté d’aujourd’hui. Renvoie {id}.', args: { id: int('Numéro du document à copier', REQ) } },

  // ── Paiements ──
  {
    call: 'payments.list',
    title: 'Liste des paiements',
    description: 'Encaissements des clients et décaissements aux fournisseurs (2 000 au plus). Renvoie un tableau {id, direction, date, amount, method, reference, note, party_name, party_kind, document_number, document_type}.',
    args: { direction: text('in = encaissements, out = décaissements ; absent = tous', { enum: ['in', 'out'] }), from, to, search: text('Texte cherché dans le tiers, le numéro du document ou la référence') }
  },
  {
    call: 'payments.add',
    title: 'Enregistrer un paiement',
    description: 'Règle tout ou partie d’une facture, d’un avoir ou d’une facture fournisseur validés ; le montant ne dépasse pas le reste à payer. L’écriture comptable est passée. Renvoie {id}.',
    args: {
      document_id: int('Numéro du document réglé (id de documents_list)', REQ),
      amount: amount('Montant en francs CFA, supérieur à zéro', REQ),
      method: text(`Mode de paiement : ${METHODS.join(', ')}`, REQ),
      date: text('Date du paiement, AAAA-MM-JJ ; absente : aujourd’hui'),
      reference: text('Référence (numéro de transaction, de chèque…)'),
      note: text('Note')
    }
  },
  { call: 'payments.delete', title: 'Supprimer un paiement', description: 'Supprime un paiement et son écriture comptable ; refusé pour un paiement d’une caisse clôturée. Renvoie true.', args: { id: int('Numéro du paiement (id de payments_list)', REQ) } },

  // ── Stock ──
  {
    call: 'stock.movements',
    title: 'Mouvements de stock',
    description: 'Entrées et sorties de stock, du plus récent au plus ancien (2 000 au plus). Renvoie un tableau {id, date, quantity, unit_cost, kind, note, ref, product_name, warehouse_name, document_number}. Quantité positive = entrée.',
    args: { productId: int('Seulement cet article'), warehouseId: int('Seulement ce dépôt'), from, to }
  },
  { call: 'stock.valuation', title: 'Valeur du stock', description: 'Stock de chaque produit actif valorisé au coût moyen pondéré. Renvoie un tableau {ref, name, category, unit, stock_qty, avg_cost, value, sale_price}.' },
  { call: 'stock.warehouses', title: 'Dépôts', description: 'Dépôts de la société avec la valeur du stock et le nombre d’articles présents. Renvoie un tableau {id, code, name, address, active, stock_value, products}.' },
  {
    call: 'stock.byWarehouse',
    title: 'Stock par dépôt',
    description: 'Quantité de chaque produit dans chaque dépôt. Renvoie {warehouses, rows} ; chaque ligne {id, ref, name, unit, stock_qty, min_stock, avg_cost, by_wh} où by_wh associe le numéro du dépôt à la quantité.',
    args: { search: text('Texte cherché dans la désignation ou la référence') }
  },
  { call: 'stock.transfers', title: 'Transferts entre dépôts', description: 'Les 300 derniers transferts. Renvoie un tableau {id, number, date, from_name, to_name, note, lines} avec les articles et quantités transférés.' },
  {
    call: 'stock.lots',
    title: 'Lots et numéros de série',
    description: 'Lots et numéros de série en stock, par date de péremption. Renvoie un tableau {product_id, product_name, ref, warehouse_name, lot, expiry, qty}.',
    args: { productId: int('Seulement cet article'), warehouseId: int('Seulement ce dépôt'), search: text('Texte cherché dans le lot ou la désignation'), withEmpty: bool('Vrai : inclure les lots épuisés') }
  },
  { call: 'stock.trace', title: 'Traçabilité d’un lot', description: 'Où se trouve un lot ou un numéro de série, et les documents par lesquels il est entré et sorti. Renvoie {stock, documents}.', args: { lot: text('Numéro de lot ou de série exact', REQ) } },
  {
    call: 'stock.adjust',
    title: 'Entrée ou sortie de stock',
    description: 'Mouvement manuel sur un produit : stock initial, casse, perte, échantillon. Une sortie qui rendrait le stock négatif est refusée. Renvoie true.',
    args: {
      productId: int('Article concerné (id de products_list)', REQ),
      quantity: amount('Quantité : positive pour une entrée, négative pour une sortie', REQ),
      note: text('Motif du mouvement', REQ),
      unitCost: amount('Entrée : coût d’achat unitaire en francs CFA ; absent : coût moyen actuel'),
      date: text('Date, AAAA-MM-JJ ; absente : aujourd’hui'),
      warehouseId: int('Dépôt ; absent : dépôt principal'),
      lots: { type: 'array', description: 'Article suivi par lot ou série : lots entrés ou sortis', items: { type: 'object', properties: { lot: { type: 'string' }, qty: { type: 'number' }, expiry: { type: 'string', description: 'Péremption, AAAA-MM-JJ' } }, required: ['lot', 'qty'] } }
    }
  },
  {
    call: 'stock.transfer',
    title: 'Transférer du stock entre dépôts',
    description: 'Sort des articles d’un dépôt et les entre dans un autre ; refusé si le stock du dépôt d’origine ne suffit pas. Renvoie {id, number}.',
    args: {
      from: int('Dépôt d’origine (id de stock_warehouses)', REQ),
      to: int('Dépôt de destination, différent de l’origine', REQ),
      lines: { type: 'array', description: 'Articles à transférer', required: true, items: { type: 'object', properties: { productId: { type: 'integer' }, quantity: { type: 'number' }, lot: { type: 'string', description: 'Lot ou numéro de série, pour un article suivi' } }, required: ['productId', 'quantity'] } },
      date: text('Date, AAAA-MM-JJ ; absente : aujourd’hui'),
      note: text('Note')
    }
  },

  // ── Tableau de bord et rapports ──
  { call: 'reports.dashboard', title: 'Tableau de bord', description: 'Chiffres clés du jour : ventes du mois et de l’année (hors taxes), créances clients, dettes fournisseurs, encaissements du mois, factures en retard, articles sous le seuil, meilleurs clients et articles. Renvoie {salesMonth, salesYear, receivable, payable, cashIn, cashOut, overdue, lowStock, topClients, topProducts, monthly…}.' },
  {
    call: 'reports.sales',
    title: 'Rapport des ventes',
    description: 'Ventes d’une période, avoirs déduits : par mois, par client, par article (avec le coût), TVA collectée et déductible, achats par fournisseur. Renvoie {byMonth, byClient, byProduct, tva, purchases}.',
    args: { from: text('Début de la période, AAAA-MM-JJ', REQ), to: text('Fin de la période, AAAA-MM-JJ', REQ) }
  },

  // ── Caisse (celle de l'administrateur qui a créé la clé) ──
  { call: 'cash.current', title: 'Caisse ouverte', description: 'Caisse en cours de l’administrateur qui a créé la clé : fonds de départ, ventes, entrées et sorties, espèces attendues. Renvoie {session, byMethod, movements, sales, salesTotal, expected}, ou null si la caisse est fermée.' },
  { call: 'cash.history', title: 'Historique des caisses', description: 'Les 300 dernières sessions de caisse de tous les caissiers. Renvoie un tableau {id, user_name, status, opened_at, closed_at, opening_amount, expected_amount, counted_amount, sales_total, note}.', args: { from: text('Ouvertes à partir du, AAAA-MM-JJ'), to: text('Ouvertes jusqu’au, AAAA-MM-JJ') } },
  { call: 'cash.detail', title: 'Détail d’une caisse', description: 'Une session de caisse : ventes, règlements par mode, entrées et sorties d’espèces, montant attendu. Renvoie {session, byMethod, movements, sales, salesTotal, expected}.', args: { id: int('Numéro de la session (id de cash_history)', REQ) } },
  { call: 'cash.open', title: 'Ouvrir la caisse', description: 'Ouvre la caisse de l’administrateur qui a créé la clé ; refusé si elle est déjà ouverte. Renvoie {id}.', args: { opening_amount: amount('Fonds de caisse au départ, en francs CFA (0 possible)', REQ) } },
  {
    call: 'cash.sale',
    title: 'Vente au comptoir',
    description: 'Crée une facture validée et l’encaisse dans la caisse ouverte. Sans party_id, la vente va au client comptoir et doit être réglée en totalité. Renvoie {id, number, total_ttc, paid}.',
    args: {
      lines: { type: 'array', description: 'Articles vendus', required: true, items: LINES },
      payments: { type: 'array', description: 'Règlements reçus', required: true, items: { type: 'object', properties: { method: { type: 'string', enum: METHODS }, amount: { type: 'number', description: 'Montant en francs CFA' } }, required: ['method', 'amount'] } },
      party_id: int('Client de la vente ; absent : client comptoir'),
      notes: text('Note sur la facture')
    }
  },
  {
    call: 'cash.movement',
    title: 'Entrée ou sortie d’espèces',
    description: 'Mouvement d’espèces hors vente dans la caisse ouverte (apport, dépôt en banque, petite dépense), avec son écriture comptable. Renvoie {id}.',
    args: {
      kind: text('entree ou sortie', { ...REQ, enum: ['entree', 'sortie'] }),
      amount: amount('Montant en francs CFA, supérieur à zéro', REQ),
      account: text('Compte de contrepartie du plan comptable (accounting_accounts), autre que 571', REQ),
      label: text('Motif', REQ)
    }
  },
  {
    call: 'cash.close',
    title: 'Clôturer la caisse',
    description: 'Clôture la caisse ouverte après comptage du tiroir ; l’écart avec le montant attendu est passé en comptabilité. Une caisse clôturée ne se rouvre pas. Renvoie le détail de la session.',
    args: { counted_amount: amount('Espèces comptées dans le tiroir, en francs CFA', REQ), note: text('Explication, obligatoire en cas d’écart') }
  },

  // ── Comptabilité (consultation) ──
  { call: 'accounting.accounts', title: 'Plan comptable', description: 'Comptes SYSCOHADA de la société avec leurs totaux. Renvoie un tableau {number, label, active, debit, credit}.' },
  {
    call: 'accounting.entries',
    title: 'Écritures comptables',
    description: 'Écritures des journaux avec leurs lignes (500 au plus). Renvoie un tableau {id, journal, number, date, label, source, lines} ; chaque ligne {account, account_label, label, debit, credit, party_name}.',
    args: { journal: text('VT ventes, AC achats, CA caisse, MM mobile money, BQ banque, OD opérations diverses ; absent = tous', { enum: ['VT', 'AC', 'CA', 'MM', 'BQ', 'OD'] }), from, to, search: text('Texte cherché dans le libellé ou le numéro') }
  },
  {
    call: 'accounting.ledger',
    title: 'Grand livre',
    description: 'Mouvements d’un compte, ou de tous les comptes d’une racine, avec solde progressif (5 000 lignes au plus). Renvoie {opening, lines, closing}.',
    args: { account: text('Compte ou racine : 411, 60, 6…', REQ), from, to, partyId: int('Seulement les lignes de ce tiers') }
  },
  { call: 'accounting.balance', title: 'Balance générale', description: 'Mouvements de la période et solde cumulé de chaque compte mouvementé. Renvoie un tableau {number, label, debit, credit, balance}.', args: { from, to } },
  { call: 'accounting.income', title: 'Compte de résultat', description: 'Charges et produits de la période. Renvoie {charges, produits, totalCharges, totalProduits, result} ; result positif = bénéfice.', args: { from, to } },
  { call: 'accounting.balanceSheet', title: 'Bilan', description: 'Bilan SYSCOHADA à une date : actif et passif par rubrique. Renvoie {actif, passif, totalActif, totalPassif, result, balanced}.', args: { to: text('Date du bilan, AAAA-MM-JJ ; absente : toutes les écritures') } },
  { call: 'declarations.month', title: 'Déclarations du mois', description: 'Éléments des déclarations fiscales et sociales d’un mois : TVA collectée par taux et déductible, retenues à la source subies et opérées, salaires.', args: { month: text('Mois, AAAA-MM', REQ) } },
  { call: 'taxes.list', title: 'Taxes', description: 'Taxes et retenues paramétrées ; leur code sert à l’argument taxes de documents_save. Renvoie un tableau {id, code, label, kind, base, rate, amount, applies_to, auto, active}.', args: { activeOnly: bool('Vrai : seulement les taxes actives'), side: text('sale = ventes, purchase = achats ; absent = toutes', { enum: ['sale', 'purchase'] }) } },
  { call: 'assets.list', title: 'Immobilisations', description: 'Biens immobilisés avec leur plan d’amortissement. Renvoie un tableau {id, code, name, account, acquisition_date, value, duration_years, status, cumulated, net_value, dotation_year, schedule}.', args: { search: text('Texte cherché dans la désignation ou le code'), status: text('actif, cede ou rebut ; absent = tous', { enum: ['actif', 'cede', 'rebut'] }) } },
  { call: 'budget.get', title: 'Budget de l’année', description: 'Budget par compte : montants prévus et réalisés des 12 mois. Renvoie {year, lines} ; chaque ligne {account, label, planned, actual, totalPlanned, totalActual}.', args: { year: int('Année ; absente : année en cours') } },
  { call: 'budget.forecasts', title: 'Prévisions de trésorerie', description: 'Entrées et sorties prévues saisies à la main. Renvoie un tableau {id, date, label, amount, recurrence, end_date} ; montant négatif = sortie.' },
  { call: 'recurring.list', title: 'Factures récurrentes', description: 'Contrats facturés à échéance fixe (maintenance, abonnement, loyer). Renvoie un tableau {id, label, party_name, frequency, next_date, end_date, auto_validate, active, amount_ht, last_number}.' },
  { call: 'recurring.upcoming', title: 'Échéances à venir', description: 'Contrats récurrents à facturer dans les prochains jours. Renvoie un tableau {id, label, next_date, party_name}.', args: { days: int('Nombre de jours à venir ; 7 par défaut') } },

  // ── Notes de frais et expressions de besoin ──
  {
    call: 'expenses.list',
    title: 'Dépenses et notes de frais',
    description: 'Dépenses de l’entreprise et leur état dans le circuit (saisie, approbation, paiement). Renvoie {rows, totals, byCategory, rights} ; chaque dépense {id, number, date, category, label, amount, method, beneficiary, status, user_name, project_name}.',
    args: { status: text('État ; absent = tous', { enum: ['brouillon', 'soumise', 'approuvee', 'payee', 'rejetee'] }), search: text('Texte cherché dans l’objet, le bénéficiaire, le numéro ou l’auteur'), from, to, mine: bool('Vrai : seulement celles de l’administrateur qui a créé la clé') }
  },
  { call: 'expenses.get', title: 'Détail d’une dépense', description: 'Dépense complète avec l’historique de ses étapes (création, envoi, approbation, paiement). Renvoie {id, number, date, category, label, amount, status, notes, user_name, events…}.', args: { id: int('Numéro de la dépense (id de expenses_list)', REQ) } },
  {
    call: 'expenses.save',
    title: 'Créer ou modifier une dépense',
    description: 'Enregistre une note de frais en brouillon ; avec submit, l’envoie en approbation. id : absent pour créer, présent pour modifier un brouillon ou une dépense rejetée (renvoyez tous les champs). Renvoie {id, status}.',
    args: {
      id: int('Numéro de la dépense à modifier ; absent pour créer'),
      category: text('Catégorie de dépense', { ...REQ, enum: Object.keys(EXPENSE_CATEGORIES) }),
      label: text('Objet de la dépense', REQ),
      amount: amount('Montant en francs CFA, supérieur à zéro', REQ),
      date: text('Date de la dépense, AAAA-MM-JJ ; absente : aujourd’hui'),
      method: text('Mode de paiement ; Espèces par défaut', { enum: METHODS }),
      beneficiary: text('Bénéficiaire (commerçant, prestataire…)'),
      notes: text('Notes'),
      project_id: int('Projet rattaché (projects_list)'),
      submit: bool('Vrai : envoyer aussitôt en approbation')
    }
  },
  { call: 'expenses.submit', title: 'Envoyer une dépense en approbation', description: 'Fait passer un brouillon à l’état « soumise » et lui attribue son numéro (DEP-AAAA-0001). Renvoie {id, status}.', args: { id: int('Numéro du brouillon', REQ) } },
  {
    call: 'expenses.decide',
    title: 'Approuver ou rejeter une dépense',
    description: 'Décision du responsable sur une dépense soumise : approuvée (à payer) ou rejetée (retour à son auteur). Renvoie {id, status}.',
    args: { id: int('Numéro de la dépense soumise', REQ), approve: bool('Vrai pour approuver, faux pour rejeter', REQ), comment: text('Commentaire ; obligatoire pour un rejet') }
  },
  {
    call: 'expenses.pay',
    title: 'Payer une dépense approuvée',
    description: 'Marque une dépense approuvée comme payée et passe l’écriture comptable (charge contre trésorerie). Renvoie {id, status}.',
    args: { id: int('Numéro de la dépense approuvée', REQ), date: text('Date du paiement, AAAA-MM-JJ ; absente : aujourd’hui'), method: text('Mode de paiement ; absent : celui de la dépense', { enum: METHODS }) }
  },
  { call: 'expenses.delete', title: 'Supprimer une dépense', description: 'Supprime définitivement une dépense en brouillon ou rejetée. Renvoie true.', args: { id: int('Numéro de la dépense', REQ) } },
  {
    call: 'requests.list',
    title: 'Expressions de besoin',
    description: 'Demandes d’achat internes et leur état (visa, validation financière, commande). Renvoie {rows, counts, rights} ; chaque demande {id, number, date, needed_by, title, department, priority, status, total, user_name, document_number}.',
    args: { status: text('État ; absent = tous', { enum: Object.keys(REQUEST_STATUS) }), search: text('Texte cherché dans l’objet, le service, le numéro ou l’auteur'), mine: bool('Vrai : seulement celles de l’administrateur qui a créé la clé') }
  },
  { call: 'requests.get', title: 'Détail d’une expression de besoin', description: 'Demande d’achat complète : lignes, justification, historique des décisions, bon de commande lié. Renvoie {id, number, title, status, total, lines, events, document…}.', args: { id: int('Numéro de la demande (id de requests_list)', REQ) } },

  // ── CRM ──
  {
    call: 'crm.list',
    title: 'Opportunités commerciales',
    description: 'Opportunités du pipeline (1 000 au plus) ; celles gagnées ou perdues depuis plus de 90 jours sont masquées. Renvoie un tableau {id, title, party_id, party_name, prospect_name, amount, probability, stage, expected_date, owner_name, quote_number, next_due, activities}.',
    args: { search: text('Texte cherché dans l’intitulé, le client ou le contact'), owner: int('Seulement les opportunités de cet utilisateur'), includeClosed: bool('Vrai : inclure toutes les opportunités gagnées ou perdues') }
  },
  { call: 'crm.get', title: 'Détail d’une opportunité', description: 'Opportunité complète avec ses activités (appels, réunions, tâches). Renvoie {id, title, stage, amount, probability, contact, phone, email, notes, lost_reason, activities…}.', args: { id: int('Numéro de l’opportunité (id de crm_list)', REQ) } },
  { call: 'crm.agenda', title: 'Activités à faire', description: 'Activités commerciales non faites qui ont une échéance, de la plus ancienne à la plus lointaine (100 au plus). Renvoie un tableau {id, kind, subject, due_date, opportunity_title, who, who_id}.', args: { mine: bool('Vrai : seulement celles de l’administrateur qui a créé la clé') } },
  { call: 'crm.pipeline', title: 'Synthèse du pipeline', description: 'Nombre, montant et montant pondéré des opportunités par étape, total en cours et taux de réussite. Renvoie {stages, open, winRate}.' },
  { call: 'crm.clients', title: 'Clients à choisir (CRM)', description: 'Clients actifs, pour choisir le party_id d’une opportunité. Renvoie un tableau {id, name}.' },
  {
    call: 'crm.save',
    title: 'Créer ou modifier une opportunité',
    description: `Enregistre une opportunité commerciale, pour un client existant (party_id) ou un prospect (prospect_name). id : absent pour créer, présent pour modifier. ${FULL} Renvoie {id}.`,
    args: {
      id: int('Numéro de l’opportunité à modifier ; absent pour créer'),
      title: text('Intitulé de l’affaire', REQ),
      party_id: int('Client existant (crm_clients) ; sinon prospect_name'),
      prospect_name: text('Nom du prospect, s’il n’est pas encore client'),
      contact: text('Nom de l’interlocuteur'),
      phone: text('Téléphone'),
      email: text('Adresse e-mail'),
      amount: amount('Montant espéré toutes taxes comprises, en francs CFA'),
      stage: text('Étape ; nouveau par défaut', { enum: STAGES }),
      probability: int('Chance de réussite en pourcentage ; absente : celle de l’étape'),
      expected_date: text('Date de conclusion espérée, AAAA-MM-JJ'),
      source: text('Origine (salon, recommandation, site web…)'),
      notes: text('Notes'),
      owner_id: int('Utilisateur responsable ; absent : l’administrateur de la clé')
    }
  },
  {
    call: 'crm.move',
    title: 'Changer l’étape d’une opportunité',
    description: 'Fait avancer ou reculer une opportunité dans le pipeline ; la probabilité suit l’étape et le changement est noté dans ses activités. Renvoie true.',
    args: { id: int('Numéro de l’opportunité', REQ), stage: text('Nouvelle étape', { ...REQ, enum: STAGES }), lost_reason: text('Raison de la perte (prix, concurrent, délai…) ; obligatoire pour l’étape perdu') }
  },
  {
    call: 'crm.saveActivity',
    title: 'Créer ou modifier une activité commerciale',
    description: 'Enregistre un appel, une réunion, une visite, une note ou une tâche, rattaché à une opportunité ou à un client. id : absent pour créer, présent pour modifier. Renvoie true.',
    args: {
      id: int('Numéro de l’activité à modifier ; absent pour créer'),
      opportunity_id: int('Opportunité concernée ; à la création, elle ou party_id est obligatoire'),
      party_id: int('Client concerné, sans opportunité'),
      kind: text('Type d’activité', { ...REQ, enum: ['appel', 'reunion', 'email', 'visite', 'note', 'tache'] }),
      subject: text('Ce qui a été fait ou reste à faire', REQ),
      due_date: text('Échéance, AAAA-MM-JJ'),
      done: bool('Vrai : activité déjà faite')
    }
  },
  { call: 'crm.toggleActivity', title: 'Cocher ou décocher une activité', description: 'Inverse l’état d’une activité : faite devient à faire, à faire devient faite. Renvoie true.', args: { id: int('Numéro de l’activité (crm_get ou crm_agenda)', REQ) } },
  { call: 'crm.createQuote', title: 'Transformer une opportunité en devis', description: 'Crée un devis en brouillon du montant de l’opportunité (TVA 18 % comprise) ; un prospect devient une fiche client. Une seule fois par opportunité. Renvoie {documentId}.', args: { id: int('Numéro de l’opportunité', REQ) } },

  // ── Projets ──
  {
    call: 'projects.list',
    title: 'Liste des projets',
    description: 'Projets et chantiers avec leur suivi. Renvoie un tableau {id, code, name, status, party_name, manager_name, start_date, end_date, budget_amount, hours, unbilled, invoiced, purchases, expenses, tasks_total, tasks_done, tasks_late}.',
    args: { search: text('Texte cherché dans le nom, le code ou le client'), status: text('État ; absent = tous', { enum: PROJECT_STATUS }) }
  },
  { call: 'projects.get', title: 'Détail d’un projet', description: 'Projet complet : temps saisis, dépenses, tâches, documents liés, budget par poste, coûts, marge et alertes. Renvoie {…projet, entries, expenses, tasks, documents, byCategory, totalCost, margin, progress, alerts}.', args: { id: int('Numéro du projet (id de projects_list)', REQ) } },
  {
    call: 'projects.save',
    title: 'Créer ou modifier un projet',
    description: `Enregistre un projet ou un chantier. id : absent pour créer, présent pour modifier. ${FULL} Renvoie {id}.`,
    args: {
      id: int('Numéro du projet à modifier ; absent pour créer'),
      name: text('Nom du projet', REQ),
      code: text('Code, à la création seulement ; absent : PRJ-AAAA-001 attribué'),
      party_id: int('Client du projet (nécessaire pour facturer)'),
      status: text('État ; en_cours par défaut', { enum: PROJECT_STATUS }),
      start_date: text('Début, AAAA-MM-JJ'),
      end_date: text('Fin prévue, AAAA-MM-JJ'),
      budget_amount: amount('Budget de coûts, en francs CFA'),
      budget_hours: amount('Budget d’heures'),
      hourly_rate: amount('Taux horaire facturé, en francs CFA'),
      cost_rate: amount('Coût horaire interne, en francs CFA'),
      manager_id: int('Utilisateur responsable ; absent : l’administrateur de la clé'),
      description: text('Description'),
      budget_lines: { type: 'object', description: `Budget par poste de dépense, en francs CFA. Postes : ${Object.keys(PROJECT_EXPENSES).join(', ')}` }
    }
  },
  {
    call: 'projects.saveTask',
    title: 'Créer ou modifier une tâche de projet',
    description: `Enregistre une tâche ou un jalon. id : absent pour créer (project_id obligatoire), présent pour modifier. ${FULL} Renvoie {id}.`,
    args: {
      id: int('Numéro de la tâche à modifier ; absent pour créer'),
      project_id: int('Projet de la tâche, obligatoire à la création'),
      title: text('Intitulé', REQ),
      description: text('Description'),
      status: text('État ; a_faire par défaut', { enum: TASK_STATUS }),
      milestone: bool('Vrai : jalon'),
      assignee_id: int('Utilisateur chargé de la tâche'),
      start_date: text('Début, AAAA-MM-JJ'),
      due_date: text('Échéance, AAAA-MM-JJ, pas avant le début'),
      estimated_hours: amount('Heures estimées'),
      progress: int('Avancement en pourcentage, de 0 à 100')
    }
  },
  { call: 'projects.moveTask', title: 'Changer l’état d’une tâche', description: 'Passe une tâche à un autre état ; termine la met à 100 %. Renvoie true.', args: { id: int('Numéro de la tâche (projects_get)', REQ), status: text('Nouvel état', { ...REQ, enum: TASK_STATUS }) } },
  {
    call: 'projects.saveTime',
    title: 'Saisir du temps sur un projet',
    description: 'Enregistre des heures de travail sur un projet. id : absent pour créer, présent pour modifier un temps non facturé. Renvoie {id}.',
    args: {
      id: int('Numéro de la saisie à modifier ; absent pour créer'),
      project_id: int('Projet concerné', REQ),
      hours: amount('Durée en heures, de plus de 0 à 24', REQ),
      description: text('Travail effectué', REQ),
      date: text('Date, AAAA-MM-JJ ; absente : aujourd’hui'),
      billable: bool('Faux : temps non facturable (facturable par défaut)'),
      rate: amount('Taux horaire de cette saisie, en francs CFA ; 0 ou absent : taux du projet'),
      task_id: int('Tâche du projet concernée')
    }
  },
  {
    call: 'projects.saveExpense',
    title: 'Enregistrer une dépense de projet',
    description: 'Enregistre une dépense imputée à un projet, avec son écriture comptable. id : absent pour créer, présent pour modifier une dépense non refacturée (renvoyez tous les champs). Renvoie {id}.',
    args: {
      id: int('Numéro de la dépense à modifier ; absent pour créer'),
      project_id: int('Projet concerné', REQ),
      category: text('Poste de dépense', { ...REQ, enum: Object.keys(PROJECT_EXPENSES) }),
      description: text('Nature de la dépense', REQ),
      amount_ht: amount('Montant hors taxes, en francs CFA', REQ),
      tva_rate: amount('Taux de TVA en pourcentage ; 0 par défaut'),
      date: text('Date, AAAA-MM-JJ ; absente : aujourd’hui'),
      supplier: text('Fournisseur'),
      paid: bool('Faux : dépense à payer plus tard (payée par défaut)'),
      payment_method: text('Mode de paiement d’une dépense payée ; Espèces par défaut', { enum: METHODS }),
      billable: bool('Vrai : à refacturer au client'),
      markup: amount('Marge de refacturation en pourcentage')
    }
  },
  { call: 'projects.invoiceTime', title: 'Facturer les temps d’un projet', description: 'Crée une facture en brouillon avec les heures facturables non encore facturées, une ligne par saisie ; le projet doit avoir un client. Renvoie {documentId}.', args: { id: int('Numéro du projet', REQ) } }
]
