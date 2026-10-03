// Catalogue : produits stockés et prestations de service.

import { audit, fail, num, str, type Ctx } from './context'

export async function listProducts(ctx: Ctx, args: { search?: string; kind?: string; includeInactive?: boolean; lowStock?: boolean } = {}) {
  const search = `%${str(args.search).toLowerCase()}%`
  return ctx.db.query(
    `SELECT *, stock_qty * avg_cost AS stock_value FROM products
     WHERE ($1 OR active)
       AND ($2 = '' OR kind = $2)
       AND (lower(name) LIKE $3 OR lower(ref) LIKE $3 OR lower(category) LIKE $3)
       AND (NOT $4 OR (kind = 'produit' AND stock_qty <= min_stock))
     ORDER BY name`,
    [!!args.includeInactive, str(args.kind), search, !!args.lowStock]
  )
}

export async function listCategories(ctx: Ctx) {
  const rows = await ctx.db.query<{ category: string }>(
    "SELECT DISTINCT category FROM products WHERE category <> '' ORDER BY category"
  )
  return rows.map((r) => r.category)
}

export async function saveProduct(ctx: Ctx, input: any) {
  const kind = input.kind === 'prestation' ? 'prestation' : 'produit'
  const name = str(input.name)
  if (!name) fail('La désignation est obligatoire.')
  const tva = num(input.tva_rate)
  if (tva < 0 || tva > 100) fail('Taux de TVA invalide.')
  const fields = [
    name,
    str(input.description),
    str(input.category),
    str(input.unit) || (kind === 'prestation' ? 'forfait' : 'unité'),
    num(input.sale_price),
    num(input.purchase_price),
    tva,
    kind === 'produit' ? num(input.min_stock) : 0,
    input.active ?? true
  ]
  const tracking = kind === 'produit' && ['lot', 'serie'].includes(input.tracking) ? input.tracking : 'aucun'
  return ctx.db.tx(async (db) => {
    if (input.id) {
      await db.query('UPDATE products SET tracking = $1 WHERE id = $2', [tracking, input.id])
      await db.query(
        `UPDATE products SET name=$1, description=$2, category=$3, unit=$4, sale_price=$5, purchase_price=$6,
         tva_rate=$7, min_stock=$8, active=$9,
         avg_cost = CASE WHEN kind = 'prestation' THEN $6 ELSE avg_cost END
         WHERE id=$10`,
        [...fields, input.id]
      )
      await audit(db, ctx, 'modification', 'article', input.id, name)
      return { id: input.id as number }
    }
    let ref = str(input.ref)
    if (!ref) {
      const prefix = kind === 'prestation' ? 'PRE' : 'ART'
      const row = await db.one<{ n: number }>(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(ref, '\\D', '', 'g'), '')::int), 0)::int + 1 AS n
         FROM products WHERE ref LIKE $1`,
        [prefix + '-%']
      )
      ref = `${prefix}-${String(row!.n).padStart(4, '0')}`
    }
    if (await db.one('SELECT 1 FROM products WHERE ref = $1', [ref])) fail(`La référence ${ref} existe déjà.`)
    // Le coût moyen initial reprend le prix d'achat saisi.
    const row = await db.one<{ id: number }>(
      `INSERT INTO products (kind, ref, name, description, category, unit, sale_price, purchase_price, tva_rate, min_stock, active, avg_cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [kind, ref, ...fields, num(input.purchase_price)]
    )
    await db.query('UPDATE products SET tracking = $1 WHERE id = $2', [tracking, row!.id])
    await audit(db, ctx, 'creation', 'article', row!.id, name)
    return row!
  })
}
