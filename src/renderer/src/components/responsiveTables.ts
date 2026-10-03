// Tableaux lisibles sur téléphone : chaque cellule reçoit le libellé de sa colonne
// (data-label), ce qui permet à la feuille de style d'afficher les lignes en cartes
// « libellé : valeur » sur petit écran. Fonctionne pour toutes les listes sans les modifier.

import { useEffect, type RefObject } from 'react'

function labelTable(table: HTMLTableElement) {
  const headRow = table.tHead?.rows[table.tHead.rows.length - 1]
  if (!headRow) return
  // Libellés en tenant compte des cellules fusionnées (colSpan)
  const labels: string[] = []
  for (const th of Array.from(headRow.cells)) {
    const text = (th.getAttribute('aria-label') || th.textContent || '').trim()
    for (let i = 0; i < (th.colSpan || 1); i++) labels.push(text)
  }
  for (const body of Array.from(table.tBodies)) {
    for (const tr of Array.from(body.rows)) {
      let col = 0
      for (const td of Array.from(tr.cells)) {
        const label = labels[col] ?? ''
        if (td.getAttribute('data-label') !== label && !td.hasAttribute('data-label-fixed')) td.setAttribute('data-label', label)
        col += td.colSpan || 1
      }
    }
  }
}

export function useResponsiveTables(root: RefObject<HTMLElement | null>, key: string) {
  useEffect(() => {
    const el = root.current
    if (!el || typeof MutationObserver === 'undefined') return
    let frame = 0
    const run = () => {
      frame = 0
      el.querySelectorAll<HTMLTableElement>('table.table').forEach(labelTable)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run)
    }
    run()
    const observer = new MutationObserver(schedule)
    observer.observe(el, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [root, key])
}
