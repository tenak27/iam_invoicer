// Signatures enregistrées de la société (réglage `signatories`) : chacune a un nom, une qualité et
// une image (dessinée ou importée). L'une est la signature par défaut ; un document peut en choisir
// une autre (champ `signatory_id`). Les anciens réglages signature_image / signatory_name /
// signatory_title reflètent toujours la signature par défaut.

export interface Signatory {
  id: string
  name: string
  title: string
  /** Image de la signature (data URL), vide si seule la mention est imprimée. */
  image: string
  default?: boolean
}

export const MAX_SIGNATORIES = 12

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)

/** Liste propre à partir d'une valeur quelconque (réglage lu en base, saisie de l'interface). */
export function parseSignatories(v: unknown): Signatory[] {
  if (!Array.isArray(v)) return []
  const out: Signatory[] = []
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const s = x as Record<string, unknown>
    const id = text(s.id, 40)
    if (!id) continue
    out.push({ id, name: text(s.name, 120), title: text(s.title, 120), image: typeof s.image === 'string' ? s.image : '', default: s.default === true })
    if (out.length >= MAX_SIGNATORIES) break
  }
  // Une seule signature par défaut : la première marquée, sinon la première de la liste
  const d = out.findIndex((s) => s.default)
  out.forEach((s, i) => (s.default = i === (d < 0 ? 0 : d)))
  return out
}

/** Signature à apposer : celle choisie sur le document, sinon celle par défaut, sinon les anciens réglages. */
export function pickSignatory(
  company: { signatories?: unknown; signature_image?: string; signatory_name?: string; signatory_title?: string },
  id?: string | null
): { name: string; title: string; image: string } {
  const list = parseSignatories(company.signatories)
  const s = (id ? list.find((x) => x.id === id) : undefined) ?? list.find((x) => x.default) ?? list[0]
  if (s) return { name: s.name, title: s.title, image: s.image }
  return { name: company.signatory_name ?? '', title: company.signatory_title ?? '', image: company.signature_image ?? '' }
}
