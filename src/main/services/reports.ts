// Tableau de bord et rapports.

import { todayISO } from '@shared/format'
import { str, type Ctx } from './context'

// Chiffre d'affaires HT net des avoirs.
const NET_HT = "SUM(CASE WHEN d.type = 'AV' THEN -d.total_ht ELSE d.total_ht END)"

export async function dashboard(ctx: Ctx) {
  const today = todayISO()
  const month = today.slice(0, 7)
  const year = today.slice(0, 4)
  const db = ctx.db
  const [kpi, receivable, payable, overdue, lowStock, monthly, topClients, recent] = await Promise.all([
    db.one(
      `SELECT
         COALESCE(SUM(CASE WHEN d.date LIKE $1 THEN (CASE WHEN d.type='AV' THEN -d.total_ht ELSE d.total_ht END) END), 0) AS sales_month,
         COALESCE(SUM(CASE WHEN d.date LIKE $2 THEN (CASE WHEN d.type='AV' THEN -d.total_ht ELSE d.total_ht END) END), 0) AS sales_year
       FROM documents d WHERE d.status = 'valide' AND d.type IN ('FAC','AV')`,
      [month + '%', year + '%']
    ),
    db.one(
      `SELECT COALESCE(SUM(d.total_ttc - COALESCE((SELECT SUM(amount) FROM payments WHERE document_id = d.id), 0)), 0) AS amount
       FROM documents d WHERE d.status = 'valide' AND d.type = 'FAC'`
    ),
    db.one(
      `SELECT COALESCE(SUM(d.total_ttc - COALESCE((SELECT SUM(amount) FROM payments WHERE document_id = d.id), 0)), 0) AS amount
       FROM documents d WHERE d.status = 'valide' AND d.type = 'FF'`
    ),
    db.query(
      `SELECT d.id, d.number, d.due_date, d.total_ttc, p.name AS party_name,
              d.total_ttc - COALESCE((SELECT SUM(amount) FROM payments WHERE document_id = d.id), 0) AS remaining
       FROM documents d JOIN parties p ON p.id = d.party_id
       WHERE d.status = 'valide' AND d.type = 'FAC' AND d.due_date < $1
         AND d.total_ttc > COALESCE((SELECT SUM(amount) FROM payments WHERE document_id = d.id), 0) + 0.5
       ORDER BY d.due_date LIMIT 50`,
      [today]
    ),
    db.query(
      `SELECT id, ref, name, stock_qty, min_stock, unit FROM products
       WHERE active AND kind = 'produit' AND stock_qty <= min_stock ORDER BY name LIMIT 50`
    ),
    db.query(
      `SELECT substr(d.date, 1, 7) AS month, ${NET_HT} AS sales
       FROM documents d WHERE d.status = 'valide' AND d.type IN ('FAC','AV') AND d.date >= $1
       GROUP BY 1 ORDER BY 1`,
      [`${Number(year) - 1}-${today.slice(5, 7)}-01`]
    ),
    db.query(
      `SELECT p.id, p.name, ${NET_HT} AS sales
       FROM documents d JOIN parties p ON p.id = d.party_id
       WHERE d.status = 'valide' AND d.type IN ('FAC','AV') AND d.date LIKE $1
       GROUP BY p.id, p.name ORDER BY sales DESC LIMIT 5`,
      [year + '%']
    ),
    db.query(
      `SELECT d.id, d.type, d.number, d.status, d.date, d.total_ttc, p.name AS party_name
       FROM documents d JOIN parties p ON p.id = d.party_id ORDER BY d.updated_at DESC LIMIT 8`
    )
  ])
  const cash = await db.one(
    `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END), 0) AS cash_in,
            COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END), 0) AS cash_out
     FROM payments WHERE date LIKE $1`,
    [month + '%']
  )
  return {
    salesMonth: kpi.sales_month,
    salesYear: kpi.sales_year,
    receivable: receivable.amount,
    payable: payable.amount,
    cashIn: cash.cash_in,
    cashOut: cash.cash_out,
    overdue,
    lowStock,
    monthly,
    topClients,
    recent
  }
}

export async function salesReport(ctx: Ctx, args: { from: string; to: string }) {
  const from = str(args.from)
  const to = str(args.to)
  const range = [from, to]
  const [byMonth, byClient, byProduct, tva, purchases] = await Promise.all([
    ctx.db.query(
      `SELECT substr(d.date, 1, 7) AS month, ${NET_HT} AS ht,
              SUM(CASE WHEN d.type='AV' THEN -d.total_ttc ELSE d.total_ttc END) AS ttc, COUNT(*)::int AS count
       FROM documents d WHERE d.status='valide' AND d.type IN ('FAC','AV') AND d.date BETWEEN $1 AND $2
       GROUP BY 1 ORDER BY 1`,
      range
    ),
    ctx.db.query(
      `SELECT p.code, p.name, ${NET_HT} AS ht, COUNT(*)::int AS count
       FROM documents d JOIN parties p ON p.id = d.party_id
       WHERE d.status='valide' AND d.type IN ('FAC','AV') AND d.date BETWEEN $1 AND $2
       GROUP BY p.code, p.name ORDER BY ht DESC`,
      range
    ),
    // Marge : coût = coût moyen enregistré sur les sorties de stock des ventes de la période.
    ctx.db.query(
      `WITH sold AS (
         SELECT l.product_id, l.description,
                SUM(CASE WHEN d.type='AV' THEN -l.quantity ELSE l.quantity END) AS qty,
                SUM(CASE WHEN d.type='AV' THEN -l.total_ht ELSE l.total_ht END) AS ht
         FROM document_lines l JOIN documents d ON d.id = l.document_id
         WHERE d.status='valide' AND d.type IN ('FAC','AV') AND d.date BETWEEN $1 AND $2
         GROUP BY l.product_id, l.description
       )
       SELECT COALESCE(pr.ref, '') AS ref, COALESCE(pr.name, s.description) AS name, pr.kind,
              SUM(s.qty) AS qty, SUM(s.ht) AS ht,
              SUM(s.qty) * COALESCE(MAX(pr.avg_cost), 0) AS cost
       FROM sold s LEFT JOIN products pr ON pr.id = s.product_id
       GROUP BY pr.ref, COALESCE(pr.name, s.description), pr.kind
       ORDER BY ht DESC`,
      range
    ),
    ctx.db.query(
      `SELECT substr(d.date, 1, 7) AS month,
              SUM(CASE WHEN d.type='FAC' THEN d.total_tva WHEN d.type='AV' THEN -d.total_tva ELSE 0 END) AS collected,
              SUM(CASE WHEN d.type='FF' THEN d.total_tva ELSE 0 END) AS deductible
       FROM documents d WHERE d.status='valide' AND d.type IN ('FAC','AV','FF') AND d.date BETWEEN $1 AND $2
       GROUP BY 1 ORDER BY 1`,
      range
    ),
    ctx.db.query(
      `SELECT p.code, p.name, SUM(d.total_ht) AS ht, COUNT(*)::int AS count
       FROM documents d JOIN parties p ON p.id = d.party_id
       WHERE d.status='valide' AND d.type = 'FF' AND d.date BETWEEN $1 AND $2
       GROUP BY p.code, p.name ORDER BY ht DESC`,
      range
    )
  ])
  return { byMonth, byClient, byProduct, tva, purchases }
}

export async function stockValuation(ctx: Ctx) {
  return ctx.db.query(
    `SELECT ref, name, category, unit, stock_qty, avg_cost, stock_qty * avg_cost AS value, sale_price
     FROM products WHERE kind = 'produit' AND active ORDER BY category, name`
  )
}

export async function auditLog(ctx: Ctx, args: { limit?: number } = {}) {
  return ctx.db.query(
    `SELECT a.*, u.full_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC LIMIT $1`,
    [Math.min(args.limit ?? 300, 2000)]
  )
}
