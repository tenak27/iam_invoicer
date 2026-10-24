// Survol réservé à la souris (base commune des applications IAM : source iam-erp/tools/socle/build,
// recopiée à la racine de chaque application par sync.mjs ; ne pas modifier ici). Vite lit ce fichier
// tout seul à la compilation de l'interface.
//
// Sur téléphone et tablette, le navigateur applique :hover au toucher et le laisse « collé » jusqu'au
// toucher suivant : une ligne reste surlignée, un bouton reste teinté. À la compilation, chaque règle
// de survol décorative (couleur, fond, ombre, mouvement) passe sous
// @media (hover: hover) and (pointer: fine). Celles qui révèlent un contenu (actions d'une ligne, menu,
// info-bulle) restent telles quelles, pour rester accessibles au doigt. Le retour au toucher, lui,
// passe par :active et la classe is-pressed (socle/touch.ts).

const GATE = '(hover: hover) and (pointer: fine)'
/** Propriétés qui font apparaître ou disparaître quelque chose : la règle reste accessible au toucher. */
const REVEAL = /^(display|visibility|pointer-events|content|width|height|max-width|max-height|min-width|min-height|clip-path|overflow|overflow-x|overflow-y|position|top|right|bottom|left|inset|z-index)$/

/** Sélecteur sans le contenu des parenthèses : :not(:hover), :is(:hover, …), :has(:hover) ne comptent pas. */
const flat = (sel) => sel.replace(/\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, '()')
const hovers = (sel) => /:hover\b/.test(flat(sel))

/** Dernier composé du sélecteur (l'élément réellement stylé), après le dernier combinateur. */
function subject(sel) {
  const s = flat(sel).trim()
  let depth = 0
  let cut = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '[') depth++
    else if (c === ']') depth--
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) cut = i + 1
  }
  return s.slice(cut)
}

/** Déjà conditionnée par le type de pointeur, ou étape d'une animation : on n'y touche pas. */
function exempt(rule) {
  for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) {
    if (p.type !== 'atrule') continue
    if (/keyframes$/i.test(p.name)) return true
    if (p.name === 'media' && /\b(any-)?(hover|pointer)\s*:/.test(p.params)) return true
  }
  return false
}

function hoverGate() {
  return {
    postcssPlugin: 'iam-hover-gate',
    Once(root, { AtRule }) {
      const rules = []
      root.walkRules((r) => {
        if (r.selector.includes(':hover') && !exempt(r)) rules.push(r)
      })
      for (const rule of rules) {
        const props = []
        rule.each((n) => n.type === 'decl' && props.push(n.prop.toLowerCase()))
        if (!props.length || props.some((p) => REVEAL.test(p))) continue
        const opacity = props.includes('opacity')
        const move = []
        const keep = []
        for (const s of rule.selectors) {
          const subj = subject(s)
          // Survol d'un parent qui fait paraître un enfant, ou info-bulle en ::before/::after : on garde
          if (!hovers(s) || (opacity && (!hovers(subj) || /::?(before|after)\b/.test(subj)))) keep.push(s)
          else move.push(s)
        }
        if (!move.length) continue
        const media = new AtRule({ name: 'media', params: GATE })
        media.append(rule.clone({ selectors: move }))
        if (keep.length) {
          rule.selectors = keep
          rule.after(media)
        } else rule.replaceWith(media)
      }
    }
  }
}
hoverGate.postcss = true

export default { plugins: [hoverGate()] }
