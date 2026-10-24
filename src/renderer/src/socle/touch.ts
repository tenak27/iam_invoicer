// Tactile plus réactif (base commune des applications IAM : la source est iam-erp/tools/socle,
// recopiée dans chaque application par sync.mjs ; ne pas modifier ici).
//
// - classe « touch » sur <html> pour les écrans tactiles (règles de socle.css), et « lowend » sur
//   les appareils modestes (effets de flou coupés : le défilement reste fluide) ;
// - retour visuel immédiat au toucher (classe « is-pressed ») sur tout ce qui se touche, y compris
//   les lignes et les cartes cliquables qui ne sont pas des boutons ; retiré dès que le doigt
//   glisse (défilement) ;
// - écouteur touchstart passif : sans lui, Safari (iPhone) n'applique pas les styles :active ;
// - champ en cours de saisie ramené au-dessus du clavier quand celui-ci s'ouvre.

const SELECTOR = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], label, summary, select, [data-press]'

function pressable(start: Element | null): Element | null {
  let el: Element | null = start
  for (let i = 0; el && i < 6; i++, el = el.parentElement) {
    if (el === document.body) return null
    if (el.matches(SELECTOR)) return (el as HTMLButtonElement).disabled ? null : el
    // Lignes et cartes rendues cliquables par l'application (curseur « main »)
    if (getComputedStyle(el).cursor === 'pointer') return el
  }
  return null
}

export function initTouch() {
  const root = document.documentElement
  const coarse = matchMedia('(pointer: coarse)')
  const apply = () => root.classList.toggle('touch', coarse.matches || 'ontouchstart' in window)
  apply()
  coarse.addEventListener?.('change', apply)
  const nav = navigator as Navigator & { deviceMemory?: number }
  if ((nav.hardwareConcurrency && nav.hardwareConcurrency <= 4) || (nav.deviceMemory && nav.deviceMemory <= 3)) root.classList.add('lowend')

  let pressed: Element | null = null
  let timer = 0
  const clear = () => {
    clearTimeout(timer)
    pressed?.classList.remove('is-pressed')
    pressed = null
  }
  document.addEventListener(
    'touchstart',
    (e) => {
      clear()
      const el = pressable(e.target as Element | null)
      if (!el) return
      pressed = el
      el.classList.add('is-pressed')
      // Sécurité : un relâchement jamais reçu ne laisse pas l'élément enfoncé
      timer = window.setTimeout(clear, 700)
    },
    { passive: true }
  )
  // Relâché : l'appui reste visible un instant ; glissé : retiré tout de suite (c'est un défilement)
  document.addEventListener('touchend', () => {
    if (!pressed) return
    clearTimeout(timer)
    timer = window.setTimeout(clear, 110)
  }, { passive: true })
  document.addEventListener('touchmove', () => pressed && clear(), { passive: true })
  document.addEventListener('touchcancel', clear, { passive: true })
  document.addEventListener('scroll', () => pressed && clear(), { passive: true, capture: true })

  // Clavier ouvert (la zone visible rétrécit) : le champ actif reste visible
  const vv = window.visualViewport
  if (vv) {
    let height = vv.height
    vv.addEventListener('resize', () => {
      const shrunk = vv.height < height - 120
      height = vv.height
      const el = document.activeElement as HTMLElement | null
      if (shrunk && el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80)
    })
  }
}
