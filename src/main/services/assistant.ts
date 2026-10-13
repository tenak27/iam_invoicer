// Assistant du jour : ce qui mérite l'attention aujourd'hui, selon les droits de la personne
// connectée. Chaque point mène à l'écran où il se traite.

import { can, type Module } from '@shared/domain'
import { formatMoney, todayISO } from '@shared/format'
import type { Ctx } from './context'
import { licenceStatus } from './licence'
import { getSettings } from './settings'

export interface AssistantItem {
  key: string
  tone: 'danger' | 'warn' | 'info'
  title: string
  detail: string
  /** Écran de l'application où traiter ce point. */
  to: string
}

const PAID = 'COALESCE((SELECT SUM(amount) FROM payments WHERE document_id = d.id), 0)'
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const s = (n: number) => (n > 1 ? 's' : '')

export async function listAssistant(ctx: Ctx): Promise<AssistantItem[]> {
  if (!ctx.user) return []
  const { db } = ctx
  const role = ctx.user.role
  const lic = await licenceStatus(db)
  const has = (m: Module) => can(role, m) && lic.modules.includes(m)
  const today = todayISO()
  const money = (n: number, currency: string) => formatMoney(n, currency)
  const currency = (await getSettings(db)).currency || 'FCFA'
  const items: AssistantItem[] = []

  if (has('sales')) {
    const late = await db.one<{ n: number; due: number }>(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(d.total_ttc - ${PAID}), 0)::float8 AS due FROM documents d
       WHERE d.type = 'FAC' AND d.status = 'valide' AND d.due_date < $1 AND d.total_ttc > ${PAID}`,
      [today]
    )
    if (late?.n) items.push({ key: 'retards', tone: 'danger', title: `${late.n} facture${s(late.n)} en retard de paiement`, detail: `${money(late.due, currency)} à relancer auprès de vos clients.`, to: '/docs/FAC' })

    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
    const quotes = await db.one<{ n: number; total: number }>(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(d.total_ttc), 0)::float8 AS total FROM documents d
       WHERE d.type = 'DEV' AND d.status = 'valide' AND d.date <= $1 AND d.date >= $2
         AND NOT EXISTS (SELECT 1 FROM documents c WHERE c.source_id = d.id AND c.status <> 'annule')`,
      [weekAgo, new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)]
    )
    if (quotes?.n) items.push({ key: 'devis', tone: 'warn', title: `${quotes.n} devis sans suite depuis plus de 7 jours`, detail: `${money(quotes.total, currency)} en attente : un rappel peut les transformer en commandes.`, to: '/docs/DEV' })

    const drafts = await db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM documents WHERE status = 'brouillon' AND type IN ('DEV','BL','FAC','AV')`)
    if (drafts?.n) items.push({ key: 'brouillons', tone: 'info', title: `${drafts.n} brouillon${s(drafts.n)} à terminer`, detail: 'Un brouillon n’a pas de numéro et ne compte ni dans le stock ni en comptabilité.', to: '/docs/FAC' })
  }

  if (has('purchases')) {
    const bills = await db.one<{ n: number; due: number }>(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(d.total_ttc - ${PAID}), 0)::float8 AS due FROM documents d
       WHERE d.type = 'FF' AND d.status = 'valide' AND d.due_date <= $1 AND d.total_ttc > ${PAID}`,
      [today]
    )
    if (bills?.n) items.push({ key: 'fournisseurs', tone: 'warn', title: `${bills.n} facture${s(bills.n)} fournisseur${s(bills.n)} à régler`, detail: `${money(bills.due, currency)} arrivés à échéance.`, to: '/docs/FF' })
  }

  if (has('stock')) {
    const low = await db.one<{ n: number; out: number }>(
      `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE stock_qty <= 0)::int AS out FROM products
       WHERE kind = 'produit' AND active AND min_stock > 0 AND stock_qty <= min_stock`
    )
    if (low?.n) items.push({ key: 'stock', tone: low.out ? 'danger' : 'warn', title: `${low.n} article${s(low.n)} sous le seuil d'alerte`, detail: low.out ? `Dont ${low.out} en rupture : à réapprovisionner.` : 'Pensez à passer commande avant la rupture.', to: '/stock' })
  }

  if (has('accounting')) {
    // Déclarations mensuelles : à déposer au plus tard le 20 du mois suivant
    const now = new Date(today + 'T00:00:00')
    const day = now.getDate()
    if (day >= 10 && day <= 20) {
      const left = 20 - day
      const prev = MONTHS[(now.getMonth() + 11) % 12]
      items.push({ key: 'declarations', tone: left <= 3 ? 'danger' : 'warn', title: left === 0 ? `Déclarations de ${prev} : dernier jour` : `Déclarations de ${prev} : ${left} jour${s(left)} restant${s(left)}`, detail: 'TVA et retenues du mois écoulé, à déposer avant le 20. Les montants sont préparés.', to: '/declarations' })
    }
  }

  const order = { danger: 0, warn: 1, info: 2 }
  return items.sort((a, b) => order[a.tone] - order[b.tone])
}
