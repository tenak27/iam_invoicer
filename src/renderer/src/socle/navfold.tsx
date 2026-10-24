// Menu latéral à sections repliables (base commune des applications IAM : source iam-erp/tools/socle,
// recopiée par sync.mjs ; ne pas modifier ici). Un clic sur le titre d'une section la replie ou la
// déplie ; le choix est gardé sur l'appareil. Une section repliée montre encore la page ouverte si
// elle en fait partie ; menu réduit aux icônes : tout reste visible.
import { useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'

export interface NavFold {
  /** La section est-elle repliée (et le menu affiché en entier, pas réduit aux icônes) ? */
  isFolded: (title: string | undefined) => boolean
  toggle: (title: string) => void
  /** Pour recalculer ce qui dépend de la hauteur du menu (indicateur de la page active). */
  version: string
}

export function useNavFold(app: string, collapsed = false): NavFold {
  const key = `${app}.menu-replie`
  const [folded, setFolded] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) || '[]')
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
    } catch {
      return []
    }
  })
  const toggle = (title: string) =>
    setFolded((f) => {
      const next = f.includes(title) ? f.filter((x) => x !== title) : [...f, title]
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* stockage indisponible : le choix vaut pour cette session */
      }
      return next
    })
  return { isFolded: (title) => !!title && !collapsed && folded.includes(title), toggle, version: `${collapsed}|${folded.join('|')}` }
}

/** Titre de section cliquable ; repliée, elle indique le nombre de pages qu'elle contient. */
export function NavFoldTitle({ title, folded, count, onToggle }: { title: string; folded: boolean; count: number; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`nav-title socle-nav-fold${folded ? ' folded' : ''}`}
      onClick={onToggle}
      aria-expanded={!folded}
      title={folded ? `Afficher la section « ${title} »` : `Replier la section « ${title} »`}
    >
      <span>{title}</span>
      {folded && <small className="socle-nav-count" aria-label={`${count} page(s)`}>{count}</small>}
      <CaretDown className="socle-nav-caret" size={12} weight="bold" aria-hidden="true" />
    </button>
  )
}
