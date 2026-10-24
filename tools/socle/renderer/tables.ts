// Tableaux lisibles sur téléphone : chaque cellule reçoit le libellé de sa colonne (data-label), ce qui
// permet à la feuille de style d'afficher les lignes en cartes « libellé : valeur » sur petit écran.
// Base commune des applications IAM : source iam-erp/tools/socle, recopiée par sync.mjs ; ne pas
// modifier ici. Une seule surveillance de la page, lancée au démarrage : aucune liste à modifier.

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

/** Libellés posés sur les tableaux « .table » de la page, puis à chaque changement d'affichage (une fois par image au plus). */
export function initTables(root: HTMLElement = document.body): () => void {
  if (typeof MutationObserver === 'undefined' || !root) return () => undefined
  let frame = 0
  const run = () => {
    frame = 0
    root.querySelectorAll<HTMLTableElement>('table.table').forEach(labelTable)
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(run)
  }
  run()
  // characterData : un titre de colonne qui change (mois affiché, par exemple) renomme ses cellules
  const observer = new MutationObserver(schedule)
  observer.observe(root, { childList: true, subtree: true, characterData: true })
  return () => {
    observer.disconnect()
    if (frame) cancelAnimationFrame(frame)
  }
}
