// Contrôles de cohérence d'une base IAM INVOICER : utilisés par l'audit (tests/integrity.test.ts)
// et réutilisables sur une base réelle (copie) pour vérifier qu'aucune donnée n'est incohérente.

import type { Db } from '../src/main/db'

export interface Finding {
  check: string
  detail: string
}

export async function checkIntegrity(db: Db): Promise<Finding[]> {
  const out: Finding[] = []
  const add = (check: string, rows: any[], fmt: (r: any) => string) => rows.forEach((r) => out.push({ check, detail: fmt(r) }))

  add('Écriture déséquilibrée', await db.query(
    `SELECT e.id, e.label, SUM(l.debit) AS d, SUM(l.credit) AS c FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
     GROUP BY e.id, e.label HAVING ABS(SUM(l.debit) - SUM(l.credit)) > 0.5`), (r) => `${r.id} ${r.label} : ${r.d} ≠ ${r.c}`)

  add('Total HT ≠ somme des lignes', await db.query(
    `SELECT d.id, d.number, d.total_ht, COALESCE((SELECT SUM(total_ht) FROM document_lines WHERE document_id = d.id), 0) AS lines
     FROM documents d WHERE ABS(d.total_ht - COALESCE((SELECT SUM(total_ht) FROM document_lines WHERE document_id = d.id), 0)) > 0.5`), (r) => `${r.number ?? r.id} : ${r.total_ht} ≠ ${r.lines}`)

  add('TTC ≠ HT + TVA + taxes', await db.query(
    `SELECT id, number, total_ht, total_tva, total_taxes, total_ttc FROM documents WHERE ABS(total_ttc - total_ht - total_tva - total_taxes) > 0.5`),
    (r) => `${r.number ?? r.id}`)

  add('Stock ≠ somme des mouvements', await db.query(
    `SELECT p.ref, p.stock_qty, COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE product_id = p.id), 0) AS moves
     FROM products p WHERE p.kind = 'produit' AND ABS(p.stock_qty - COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE product_id = p.id), 0)) > 0.001`),
    (r) => `${r.ref} : ${r.stock_qty} ≠ ${r.moves}`)

  add('Stock ≠ somme des dépôts', await db.query(
    `SELECT p.ref, p.stock_qty, COALESCE((SELECT SUM(qty) FROM product_stock WHERE product_id = p.id), 0) AS wh
     FROM products p WHERE p.kind = 'produit' AND ABS(p.stock_qty - COALESCE((SELECT SUM(qty) FROM product_stock WHERE product_id = p.id), 0)) > 0.001`),
    (r) => `${r.ref} : ${r.stock_qty} ≠ ${r.wh}`)

  add('Trop-perçu sur un document', await db.query(
    `SELECT d.number, d.total_ttc, SUM(p.amount) AS paid FROM documents d JOIN payments p ON p.document_id = d.id
     GROUP BY d.id, d.number, d.total_ttc HAVING SUM(p.amount) > d.total_ttc + 0.5`), (r) => `${r.number} : réglé ${r.paid} > ${r.total_ttc}`)

  add('Pièce validée sans écriture', await db.query(
    `SELECT d.number FROM documents d WHERE d.status = 'valide' AND d.type IN ('FAC','AV','FF')
     AND NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.source = 'document' AND e.source_id = d.id)`), (r) => r.number)

  add('Pièce annulée avec écriture', await db.query(
    `SELECT d.number FROM documents d WHERE d.status = 'annule'
     AND EXISTS (SELECT 1 FROM journal_entries e WHERE e.source = 'document' AND e.source_id = d.id)`), (r) => r.number)

  add('Règlement sans écriture', await db.query(
    `SELECT p.id, p.amount FROM payments p WHERE NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.source = 'payment' AND e.source_id = p.id)`),
    (r) => `n° ${r.id} (${r.amount})`)

  add('Solde client ≠ compte 411', await db.query(
    `SELECT pa.name,
            COALESCE((SELECT SUM(l.debit - l.credit) FROM journal_lines l WHERE l.account LIKE '411%' AND l.party_id = pa.id), 0) AS ledger,
            COALESCE((SELECT SUM(CASE WHEN d.type = 'FAC' THEN d.total_ttc ELSE -d.total_ttc END) FROM documents d
                      WHERE d.party_id = pa.id AND d.status = 'valide' AND d.type IN ('FAC','AV')), 0)
            - COALESCE((SELECT SUM(CASE WHEN py.direction = 'in' THEN py.amount ELSE -py.amount END) FROM payments py WHERE py.party_id = pa.id), 0) AS docs
     FROM parties pa WHERE pa.kind = 'client'`).then((rows) => rows.filter((r: any) => Math.abs(r.ledger - r.docs) > 0.5)),
    (r) => `${r.name} : 411 = ${r.ledger}, pièces = ${r.docs}`)

  add('Numéro en double', await db.query(
    `SELECT number, COUNT(*)::int AS n FROM documents WHERE number IS NOT NULL GROUP BY number HAVING COUNT(*) > 1`), (r) => `${r.number} × ${r.n}`)

  return out
}
