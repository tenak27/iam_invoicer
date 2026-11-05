// Désignation d'une ligne de document, avec recherche pendant la saisie : l'application propose les
// articles du catalogue (référence, nom, description, catégorie) et les désignations déjà utilisées
// sur les documents du même côté (ventes ou achats), avec le dernier prix. Clavier : flèches, Entrée,
// Échap ; au doigt, un toucher suffit. Sans choix, la désignation reste un texte libre.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClockCounterClockwise, MagnifyingGlass, Package, Wrench, X } from '@phosphor-icons/react'
import type { DocType } from '@shared/domain'
import { formatDate, formatNumber, searchText } from '@shared/format'
import { api } from '../api'

export interface PastDesignation {
  description: string
  uses: number
  last_date: string
  unit_price: number
  tva_rate: number
}

type Item = { kind: 'product'; p: any } | { kind: 'past'; h: PastDesignation }

const firstLine = (s: string) => s.split('\n')[0].trim()

export function DesignationField(props: {
  value: string
  docType: DocType
  side: 'sale' | 'purchase'
  products: any[] | undefined
  /** Article du catalogue lié à la ligne, s'il y en a un. */
  product?: any
  onChange: (text: string) => void
  onPickProduct: (id: number) => void
  onPickPast: (h: PastDesignation) => void
  onUnlink: () => void
}) {
  const { value, docType, side, products, product } = props
  const input = useRef<HTMLTextAreaElement>(null)
  const [open, setOpen] = useState(false)
  // Tant que rien n'est tapé depuis l'arrivée dans le champ, on parcourt le catalogue
  const [typed, setTyped] = useState(false)
  const [active, setActive] = useState(-1)
  const [past, setPast] = useState<PastDesignation[]>([])
  const q = typed ? firstLine(value) : ''
  const words = useMemo(() => searchText(q).split(/\s+/).filter(Boolean), [q])

  const matches = useMemo(() => {
    const list = products ?? []
    if (!words.length) return list.slice(0, 8)
    const scored: { p: any; s: number }[] = []
    for (const p of list) {
      const hay = searchText(`${p.ref} ${p.name} ${p.description ?? ''} ${p.category ?? ''}`)
      if (!words.every((w) => hay.includes(w))) continue
      const name = searchText(p.name)
      scored.push({ p, s: searchText(p.ref).startsWith(words[0]) ? 0 : name.startsWith(words[0]) ? 1 : name.includes(' ' + words[0]) ? 2 : 3 })
    }
    scored.sort((a, b) => a.s - b.s || String(a.p.name).localeCompare(String(b.p.name), 'fr'))
    return scored.slice(0, 6).map((x) => x.p)
  }, [products, words])

  // Désignations déjà utilisées : demandées au serveur un instant après la frappe
  useEffect(() => {
    if (!open || words.join('').length < 2) return setPast([])
    let alive = true
    const t = setTimeout(() => {
      api<PastDesignation[]>('documents.searchDesignations', { type: docType, q })
        .then((r) => alive && setPast(r.filter((h) => h.description.trim() !== value.trim()).slice(0, 5)))
        .catch(() => alive && setPast([])) // hors connexion : le catalogue seul
    }, 220)
    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, docType])

  const items: Item[] = [...matches.map((p): Item => ({ kind: 'product', p })), ...past.map((h): Item => ({ kind: 'past', h }))]
  useEffect(() => setActive((a) => Math.min(a, items.length - 1)), [items.length])

  // Liste posée sur la page (hors du tableau qui défile de côté), sous le champ ou au-dessus s'il manque de place
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number; max: number } | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = input.current?.getBoundingClientRect()
      if (!r) return
      const width = Math.min(Math.max(r.width, 340), innerWidth - 16)
      const left = Math.max(8, Math.min(r.left, innerWidth - width - 8))
      const below = innerHeight - r.bottom - 12
      const above = r.top - 12
      if (below >= 240 || below >= above) setBox({ left, width, top: r.bottom + 6, max: Math.min(360, below) })
      else setBox({ left, width, bottom: innerHeight - r.top + 6, max: Math.min(360, above) })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, value])

  const close = () => {
    setOpen(false)
    setActive(-1)
  }
  const pick = (it: Item) => {
    if (it.kind === 'product') props.onPickProduct(it.p.id)
    else props.onPickPast(it.h)
    setTyped(false)
    close()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (!open || !items.length) {
      if (e.key === 'ArrowDown' && !open) setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1))
    } else if (e.key === 'Enter' && !e.shiftKey && active >= 0) {
      // Entrée choisit seulement une proposition sélectionnée aux flèches ; sinon elle va à la ligne
      e.preventDefault()
      pick(items[active])
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    }
  }

  const listId = useMemo(() => `desig-${Math.random().toString(36).slice(2, 9)}`, [])
  const money = (n: number) => formatNumber(n, n % 1 ? 2 : 0)
  const price = (p: any) => (side === 'sale' ? p.sale_price : p.purchase_price)
  const productCount = matches.length

  return (
    <div className="desig">
      {product && (
        <div className="desig-link">
          {product.kind === 'produit' ? <Package size={15} weight="duotone" aria-hidden="true" /> : <Wrench size={15} weight="duotone" aria-hidden="true" />}
          <span className="ellipsis"><b>{product.ref}</b> · lié au catalogue{product.kind === 'produit' ? ` · stock ${formatNumber(product.stock_qty)}` : ''}</span>
          <button type="button" onClick={props.onUnlink} aria-label="Détacher l’article : la ligne devient libre" title="Détacher l’article (ligne libre)"><X size={13} weight="bold" /></button>
        </div>
      )}
      <textarea
        ref={input}
        rows={Math.min(4, (value.match(/\n/g)?.length ?? 0) + 1)}
        value={value}
        placeholder="Désignation : tapez pour chercher un article"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onFocus={() => {
          setTyped(false)
          setOpen(true)
        }}
        onBlur={close}
        onChange={(e) => {
          props.onChange(e.target.value)
          setTyped(true)
          setOpen(true)
          setActive(-1)
        }}
        onKeyDown={onKey}
      />
      {open && box && createPortal(
        <div
          className={`desig-pop${box.bottom !== undefined ? ' up' : ''}`}
          style={{ left: box.left, width: box.width, top: box.top, bottom: box.bottom, maxHeight: box.max }}
          // Garder le focus dans le champ : le choix se fait au relâchement, sans perdre la saisie
          onMouseDown={(e) => e.preventDefault()}
        >
          <ul id={listId} role="listbox" aria-label="Propositions">
            {items.length === 0 ? (
              <li className="desig-empty"><MagnifyingGlass size={16} aria-hidden="true" />{words.length ? 'Aucun article ni désignation trouvés : le texte reste libre.' : 'Le catalogue est vide : écrivez la désignation.'}</li>
            ) : (
              items.map((it, i) => (
                <li key={it.kind === 'product' ? `p${it.p.id}` : `h${i}`} role="presentation">
                  {(i === 0 || (it.kind === 'past' && i === productCount)) && (
                    <div className="desig-sec">{it.kind === 'product' ? (words.length ? 'Catalogue' : 'Catalogue — tapez pour chercher') : 'Déjà utilisées'}</div>
                  )}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={active === i}
                    className={`desig-item${active === i ? ' on' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(it)}
                  >
                    {it.kind === 'product' ? (
                      <>
                        <span className="desig-ic">{it.p.kind === 'produit' ? <Package size={18} weight="duotone" /> : <Wrench size={18} weight="duotone" />}</span>
                        <span className="desig-main">
                          <b className="ellipsis">{it.p.name}</b>
                          <small className="ellipsis">{it.p.ref}{it.p.kind === 'produit' ? ` · stock ${formatNumber(it.p.stock_qty)}` : ' · prestation'}{it.p.category ? ` · ${it.p.category}` : ''}</small>
                        </span>
                        <span className="desig-price">{money(price(it.p))}</span>
                      </>
                    ) : (
                      <>
                        <span className="desig-ic past"><ClockCounterClockwise size={18} /></span>
                        <span className="desig-main">
                          <b className="ellipsis">{firstLine(it.h.description)}</b>
                          <small className="ellipsis">{it.h.uses > 1 ? `${it.h.uses} fois` : 'une fois'} · dernière le {formatDate(String(it.h.last_date).slice(0, 10))}</small>
                        </span>
                        <span className="desig-price">{money(it.h.unit_price)}</span>
                      </>
                    )}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>,
        document.body
      )}
    </div>
  )
}
