// Mascotte des applications IAM (base commune : source iam-erp/tools/socle ; ne pas modifier ici).
// Deux personnages en image (elle et lui) dans public/socle/mascotte. Le personnage change à chaque
// nouvelle connexion (jeton de session différent) ; sans jeton, il suit l'heure de la journée.
// Il joue des scènes qui s'enchaînent : salut, au travail devant l'ordinateur, danse, téléphone.
//
// Mouvement (socle.css, .socle-mascotte*) : uniquement transform et opacity.
//   – dans une scène, deux calques d'image se relaient : la nouvelle image est décodée avant d'apparaître
//     au-dessus de l'ancienne, qui ne s'efface qu'ensuite (ni trou ni clignotement) ;
//   – entre deux scènes, le personnage s'efface, la scène change pendant qu'il est invisible, puis il
//     revient : deux poses sans rapport ne se superposent jamais ;
//   – le balancement et la respiration sont deux animations simples de périodes différentes, sur deux
//     enveloppes : le mouvement ne s'arrête jamais sur une image clé ;
//   – tout est en pause quand l'onglet est caché ou que la mascotte est hors de l'écran.
// Mouvement réduit demandé au système : image fixe, la scène ne change qu'au clic, sans transition.
//
// Adapter la mascotte à une application (tout est facultatif, <Mascotte token={…} /> suffit) :
//   scenes    ordre et choix des scènes, par exemple ['ordi', 'tel', 'salut'] ;
//   phrases   mot dit au clic pour chaque scène, par exemple { ordi: 'Vos chantiers sont à jour.' } ;
//   messages  mots dits à l'arrivée puis à chaque retour à la première scène ;
//   mascotteReagit('danse', 'Facture enregistrée.')  après une action réussie, depuis n'importe quel
//     écran : la mascotte affichée (ou celle qui s'affiche dans les 20 secondes) joue la scène une fois.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

export type MascotteScene = 'salut' | 'ordi' | 'danse' | 'tel'
/** Images [nom, durée en ms], durée de la scène, durée du fondu entre deux images, mot dit au clic. */
type Scene = { frames: [string, number][]; last: number; fade: number; say: string }
const SCENES: Record<MascotteScene, Scene> = {
  salut: { frames: [['salut', 2600], ['ok', 1500], ['salut', 2200], ['montre', 1600]], last: 11000, fade: 260, say: 'Tout est à jour.' },
  ordi: { frames: [['ordi1', 3400], ['ordi2', 1500]], last: 12000, fade: 260, say: 'Au travail, je m’occupe du reste.' },
  // Danse : poses très différentes, fondu bref ; une image par demi-balancement (voir socle.css)
  danse: { frames: [['danse1', 560], ['danse2', 560]], last: 7000, fade: 110, say: 'Une tâche de moins, ça se fête.' },
  tel: { frames: [['tel1', 3200], ['tel2', 1700]], last: 11000, fade: 260, say: 'Tout se suit aussi depuis le téléphone.' },
}
const ORDER: MascotteScene[] = ['salut', 'ordi', 'danse', 'tel']
const KEY = 'iam.mascotte'
const EVENT = 'iam:mascotte'
/** Durée d'une scène jouée en réaction (elle se termine à la fin de sa boucle d'images). */
const REACTION_MS = 3300
const REACTION_KEEP_MS = 20000

/** Scènes retenues pour une application : celles qui existent, sans doublon ; liste vide ou absente = les quatre. */
export function mascotteScenes(scenes?: readonly string[] | null): MascotteScene[] {
  const kept: MascotteScene[] = []
  for (const s of scenes ?? []) if ((ORDER as string[]).includes(s) && !(kept as string[]).includes(s)) kept.push(s as MascotteScene)
  return kept.length ? kept : ORDER
}

/** Elle ou lui : alterne à chaque connexion ; sans session, elle le matin et le soir, lui l'après-midi et la nuit. */
export function mascotteGenre(token?: string | null): 'f' | 'h' {
  const h = new Date().getHours()
  const byHour = (h >= 6 && h < 12) || h >= 18 ? 'f' : 'h'
  if (!token) return byHour
  try {
    const mark = token.slice(-16)
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { mark: string; genre: 'f' | 'h' } | null
    if (saved?.mark === mark) return saved.genre
    const genre = saved ? (saved.genre === 'f' ? 'h' : 'f') : byHour
    localStorage.setItem(KEY, JSON.stringify({ mark, genre }))
    return genre
  } catch {
    return byHour
  }
}

let pending: { scene: MascotteScene; message?: string; at: number } | null = null

/**
 * Fait réagir la mascotte à un événement de l'application (enregistrement réussi, paiement reçu…) :
 * elle joue la scène une fois, dit le message, puis reprend où elle en était. Sans mascotte à l'écran,
 * la réaction attend 20 secondes la prochaine mascotte affichée (retour au tableau de bord), puis s'oublie.
 */
export function mascotteReagit(scene: MascotteScene = 'danse', message?: string): void {
  if (typeof window === 'undefined') return
  pending = { scene: scene in SCENES ? scene : 'danse', message, at: Date.now() }
  window.dispatchEvent(new Event(EVENT))
}
function takeReaction() {
  const p = pending
  pending = null
  return p && Date.now() - p.at < REACTION_KEEP_MS ? p : null
}

const src = (genre: string, pose: string) => new URL(`socle/mascotte/${genre}-${pose}.webp`, document.baseURI).href
const noop = () => {}

type Props = {
  className?: string
  token?: () => string | null
  /** Mots dits à l'arrivée, puis à chaque retour à la première scène. */
  messages?: string[]
  /** Ordre et choix des scènes pour cette application (par défaut : salut, ordi, danse, tel). */
  scenes?: MascotteScene[]
  /** Mot dit au clic, scène par scène, à la place du mot commun. */
  phrases?: Partial<Record<MascotteScene, string>>
}
/** Où l'on en est : rang dans la liste des scènes, scène jouée une fois en réaction, numéro de passage. */
type At = { i: number; extra: MascotteScene | null; run: number }

export function Mascotte({ className = '', token, messages = [], scenes, phrases }: Props) {
  const [genre] = useState(() => mascotteGenre(token?.()))
  const list = useMemo(() => mascotteScenes(scenes), [(scenes ?? []).join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const [at, setAt] = useState<At>({ i: 0, extra: null, run: 0 })
  const [bubble, setBubble] = useState<{ text: string; out: boolean } | null>(null)
  // Visible (onglet au premier plan et mascotte dans l'écran) : sinon tout s'arrête
  const [active, setActive] = useState(true)
  const name = at.extra ?? list[at.i % list.length]
  // Première image : fixée une fois pour toutes, les suivantes sont posées sur les calques sans passer par React
  const [first] = useState(() => src(genre, SCENES[name].frames[0][0]))

  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLSpanElement>(null)
  const layerA = useRef<HTMLImageElement>(null)
  const layerB = useRef<HTMLImageElement>(null)
  const top = useRef<'a' | 'b'>('a')
  const shown = useRef(first)
  const swap = useRef(0)
  const pos = useRef({ frame: 0, elapsed: 0, last: 0 })
  const leaving = useRef<{ i: number; extra: MascotteScene | null } | null>(null)
  const exit = useRef<Animation | null>(null)
  const alive = useRef(true)
  const live = useRef({ at, list, active, messages, phrases })
  live.current = { at, list, active, messages, phrases }
  const hide = useRef<number[]>([])
  const said = useRef(0)
  const still = useRef(typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  const say = (text: string) => {
    hide.current.forEach((t) => window.clearTimeout(t))
    setBubble({ text, out: false })
    hide.current = [
      window.setTimeout(() => setBubble((b) => (b ? { ...b, out: true } : b)), 5000),
      window.setTimeout(() => setBubble(null), 5200),
    ]
  }

  /** Affiche une image : en fondu sur l'autre calque (fade > 0), ou tout de suite sur le calque du dessus. */
  const show = (url: string, fade: number) => {
    const a = layerA.current
    const b = layerB.current
    if (!a || !b || shown.current === url) return
    shown.current = url
    const id = ++swap.current
    const [cur, nxt] = top.current === 'a' ? [a, b] : [b, a]
    if (!fade || !nxt.animate) {
      cur.src = url
      return
    }
    nxt.src = url
    // L'image est décodée avant d'être montrée : l'ancienne reste entière jusque-là
    const ready = typeof nxt.decode === 'function' ? nxt.decode().catch(noop) : Promise.resolve()
    void ready.then(() => {
      if (!alive.current || id !== swap.current) return
      top.current = top.current === 'a' ? 'b' : 'a'
      nxt.style.zIndex = '2'
      cur.style.zIndex = '1'
      nxt.style.opacity = '1'
      cur.style.opacity = '0'
      // La nouvelle apparaît au-dessus ; l'ancienne ne s'efface qu'une fois recouverte
      nxt.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fade, easing: 'cubic-bezier(.33, 1, .68, 1)' })
      cur.animate([{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], { duration: Math.round(fade * 1.4), easing: 'linear' })
    })
  }

  const commit = (next: { i: number; extra: MascotteScene | null }) => setAt((a) => ({ ...next, run: a.run + 1 }))

  /** Change de scène : le personnage s'efface, la scène change pendant qu'il est invisible, puis il revient. */
  const go = (next: { i: number; extra: MascotteScene | null }) => {
    const el = stage.current
    if (leaving.current) {
      leaving.current = next
      return
    }
    if (still.current || !live.current.active || !el?.animate) return commit(next)
    let out: Animation
    try {
      // Une seule image clé : le départ se fait depuis l'état en cours, même en pleine entrée
      out = el.animate([{ opacity: 0, transform: 'translateY(6px) scale(.97)' }], { duration: 170, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' })
    } catch {
      return commit(next)
    }
    leaving.current = next
    exit.current = out
    const done = () => {
      if (!alive.current || !leaving.current) return
      const n = leaving.current
      leaving.current = null
      commit(n)
    }
    out.finished.then(done, done)
  }

  // Images préchargées, un mot à l'arrivée (ou la réaction qui attendait)
  useEffect(() => {
    alive.current = true
    for (const s of list) for (const [p] of SCENES[s].frames) new Image().src = src(genre, p)
    const hour = new Date().getHours()
    const hello = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir'
    const t = window.setTimeout(() => {
      // Rien à l'arrivée si la mascotte a déjà parlé (clic ou réaction dans la première seconde)
      if (!reactNow() && !hide.current.length) say(live.current.messages[0] ?? hello)
    }, 900)
    window.addEventListener(EVENT, reactNow)
    return () => {
      alive.current = false
      window.clearTimeout(t)
      hide.current.forEach((x) => window.clearTimeout(x))
      window.removeEventListener(EVENT, reactNow)
      exit.current?.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Réaction demandée par l'application : la scène est jouée une fois, avec son mot. */
  function reactNow(): boolean {
    const r = takeReaction()
    if (!r) return false
    const { at: cur, phrases: own } = live.current
    say(r.message ?? own?.[r.scene] ?? SCENES[r.scene].say)
    // Mouvement réduit : le mot suffit, l'image ne bouge pas
    if (!still.current) go({ i: leaving.current?.i ?? cur.i, extra: r.scene })
    return true
  }

  // Pause hors de l'écran ou onglet en arrière-plan
  useEffect(() => {
    const el = box.current
    let seen = true
    const update = () => setActive(seen && !document.hidden)
    const io =
      el && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => {
            seen = entries[entries.length - 1].isIntersecting
            update()
          })
        : null
    if (el) io?.observe(el)
    document.addEventListener('visibilitychange', update)
    update()
    return () => {
      io?.disconnect()
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  // Nouvelle scène : première image posée pendant que le personnage est invisible, puis il revient
  useLayoutEffect(() => {
    const sc = SCENES[name]
    pos.current = { frame: 0, elapsed: 0, last: at.extra ? Math.min(REACTION_MS, sc.last) : sc.last }
    show(src(genre, sc.frames[0][0]), 0)
    exit.current?.cancel()
    exit.current = null
    if (at.run && !still.current) stage.current?.animate?.([{ opacity: 0, transform: 'translateY(8px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.22, 1, .36, 1)' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, at.run])

  // Déroulé d'une scène : ses images s'enchaînent, puis la scène suivante prend la place
  useEffect(() => {
    if (still.current || !active) return
    const sc = SCENES[name]
    const p = pos.current
    let timer = 0
    const step = () => {
      timer = window.setTimeout(() => {
        p.elapsed += sc.frames[p.frame][1]
        p.frame += 1
        if (p.frame >= sc.frames.length) {
          p.frame = 0
          if (p.elapsed >= p.last) {
            const { at: cur, list: all } = live.current
            // Après une réaction, la scène interrompue reprend ; sinon la suivante de la liste
            if (cur.extra || all.length > 1) return go(cur.extra ? { i: cur.i, extra: null } : { i: (cur.i + 1) % all.length, extra: null })
            // Une seule scène choisie : elle continue, sans sortie ni retour
            p.elapsed = 0
          }
        }
        show(src(genre, sc.frames[p.frame][0]), sc.fade)
        step()
      }, sc.frames[p.frame][1])
    }
    step()
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, at.run, active])

  // Le personnage se penche vers le pointeur (souris seulement, sauf si l'on demande moins de mouvement)
  useEffect(() => {
    const el = box.current
    if (!el || !active || still.current || !window.matchMedia?.('(hover: hover)').matches) return
    let raf = 0
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        const dx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 500))
        el.style.setProperty('--mr', `${(dx * 3).toFixed(2)}deg`)
        el.style.setProperty('--mx', `${(dx * 6).toFixed(1)}px`)
      })
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => {
      window.removeEventListener('pointermove', move)
      cancelAnimationFrame(raf)
    }
  }, [active])

  const react = () => {
    const from = leaving.current ?? at
    const i = from.extra ? from.i : (from.i + 1) % list.length
    go({ i, extra: null })
    // Au retour à la première scène, le mot suivant de l'application ; sinon le mot de la scène
    if (i === 0 && !from.extra && messages.length) {
      said.current = (said.current + 1) % messages.length
      say(messages[said.current])
    } else say(phrases?.[list[i]] ?? SCENES[list[i]].say)
  }

  return (
    <div ref={box} className={`socle-mascotte sc-${name}${active ? '' : ' en-pause'} ${className}`}>
      {bubble && (
        <div className={`socle-mascotte-bulle${bubble.out ? ' part' : ''}`} role="status" aria-live="polite" key={bubble.text}>
          {bubble.text}
        </div>
      )}
      <button type="button" className="socle-mascotte-btn" onClick={react} aria-label="Mascotte : cliquez pour changer de scène">
        <span ref={stage} className="socle-mascotte-scene">
          <span className="socle-mascotte-balance">
            <span className="socle-mascotte-souffle">
              <img ref={layerA} src={first} alt="" width={388} height={520} draggable={false} decoding="async" />
              <img ref={layerB} className="calque" alt="" width={388} height={520} draggable={false} aria-hidden="true" />
            </span>
          </span>
        </span>
      </button>
    </div>
  )
}
