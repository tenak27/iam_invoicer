// Mascotte des applications IAM (base commune : source iam-erp/tools/socle ; ne pas modifier ici).
// Deux personnages en image (elle et lui) dans public/socle/mascotte. Le personnage change à chaque
// nouvelle connexion (jeton de session différent) ; sans jeton, il suit l'heure de la journée.
// Il joue des scènes qui s'enchaînent : salut, au travail devant l'ordinateur, danse, téléphone.
// Chaque scène alterne ses images et a son mouvement (socle.css, .socle-mascotte.sc-*). Un clic passe
// à la scène suivante avec un mot dans une bulle ; le personnage se penche vers le pointeur.
// Mouvement réduit demandé : image fixe, la scène ne change qu'au clic.
import { useEffect, useRef, useState } from 'react'

type Scene = { name: 'salut' | 'ordi' | 'danse' | 'tel'; frames: [string, number][]; last: number; say: string }
/** Images [nom, durée en ms], durée de la scène, mot dit au clic. */
const SCENES: Scene[] = [
  { name: 'salut', frames: [['salut', 2600], ['ok', 1500], ['salut', 2200], ['montre', 1600]], last: 11000, say: 'Tout est à jour.' },
  { name: 'ordi', frames: [['ordi1', 3400], ['ordi2', 1500]], last: 12000, say: 'Au travail, je m’occupe du reste.' },
  { name: 'danse', frames: [['danse1', 460], ['danse2', 460]], last: 7000, say: 'Une tâche de moins, ça se fête.' },
  { name: 'tel', frames: [['tel1', 3200], ['tel2', 1700]], last: 11000, say: 'Tout se suit aussi depuis le téléphone.' },
]
const KEY = 'iam.mascotte'

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

const src = (genre: string, pose: string) => new URL(`socle/mascotte/${genre}-${pose}.webp`, document.baseURI).href

export function Mascotte({ className = '', token, messages = [] }: { className?: string; token?: () => string | null; messages?: string[] }) {
  const [genre] = useState(() => mascotteGenre(token?.()))
  // Scène en cours, image dans la scène ; « run » relance la minuterie à chaque changement de scène
  const [at, setAt] = useState({ scene: 0, frame: 0, run: 0 })
  const [bubble, setBubble] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const hide = useRef<number | undefined>(undefined)
  const said = useRef(0)
  const still = useRef(typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  const say = (text: string) => {
    setBubble(text)
    window.clearTimeout(hide.current)
    hide.current = window.setTimeout(() => setBubble(null), 5200)
  }

  // Images préchargées, un mot à l'arrivée
  useEffect(() => {
    for (const s of SCENES) for (const [p] of s.frames) new Image().src = src(genre, p)
    const hour = new Date().getHours()
    const hello = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir'
    const t = window.setTimeout(() => say(messages[0] ?? `${hello} !`), 900)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(hide.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Déroulé d'une scène : ses images s'enchaînent, puis la scène suivante prend la place
  useEffect(() => {
    if (still.current) return
    const started = Date.now()
    let frame = 0
    let timer = 0
    const scene = SCENES[at.scene]
    const next = () => {
      timer = window.setTimeout(
        () => {
          // Onglet en arrière-plan : la scène attend
          if (document.hidden) return next()
          frame += 1
          if (frame >= scene.frames.length) {
            frame = 0
            if (Date.now() - started > scene.last) return setAt((a) => ({ scene: (a.scene + 1) % SCENES.length, frame: 0, run: a.run + 1 }))
          }
          setAt((a) => ({ ...a, frame }))
          next()
        },
        document.hidden ? 1500 : scene.frames[frame][1],
      )
    }
    next()
    img.current?.animate?.([{ scale: 0.94 }, { scale: 1 }], { duration: 400, easing: 'cubic-bezier(.2, .9, .3, 1.2)' })
    return () => window.clearTimeout(timer)
  }, [at.scene, at.run])

  // Le personnage se penche vers le pointeur (souris seulement, sauf si l'on demande moins de mouvement)
  useEffect(() => {
    const el = box.current
    if (!el || still.current || !window.matchMedia?.('(hover: hover)').matches) return
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
  }, [])

  const react = () => {
    const scene = (at.scene + 1) % SCENES.length
    setAt({ scene, frame: 0, run: at.run + 1 })
    // Au retour du salut, le mot suivant de l'application ; sinon le mot de la scène
    if (scene === 0 && messages.length) {
      said.current = (said.current + 1) % messages.length
      say(messages[said.current])
    } else say(SCENES[scene].say)
  }
  const scene = SCENES[at.scene]
  const pose = scene.frames[Math.min(at.frame, scene.frames.length - 1)][0]

  return (
    <div ref={box} className={`socle-mascotte sc-${scene.name} ${className}`}>
      {bubble && (
        <div className="socle-mascotte-bulle" role="status" aria-live="polite" key={bubble}>
          {bubble}
        </div>
      )}
      <button type="button" className="socle-mascotte-btn" onClick={react} aria-label="Mascotte : cliquez pour changer de scène">
        <img ref={img} src={src(genre, pose)} alt="" width={388} height={520} draggable={false} decoding="async" />
      </button>
    </div>
  )
}
