// Version de démonstration d'IAM INVOICER (site web, bouton « Version démo ») : une société fictive
// hébergée, partagée par les visiteurs et remise à neuf toutes les 3 heures. Chaque société hébergée
// est une base PostgreSQL : en ouvrir une par visiteur serait trop lourd pour le serveur. Elle porte
// demo_mode (main/services/demoMode.ts) : tous les modules sans quotas, aucun e-mail ni SMS envoyé,
// certification fiscale seulement simulée. Les vraies sociétés ne reçoivent jamais ces données.

import { randomBytes } from 'node:crypto'
import type { Db } from '../main/db'
import type { Ctx, SessionUser } from '../main/services/context'
import { setup } from '../main/services/auth'
import { addPayment } from '../main/services/payments'
import { convertDocument, saveDocument, validateDocument } from '../main/services/documents'
import { decideExpense, payExpense, saveExpense } from '../main/services/expenses'
import { saveParty } from '../main/services/parties'
import { saveProduct } from '../main/services/products'
import { createToken } from '../main/services/tokens'
import type { TenantManager } from './tenants'

export const DEMO_SLUG = 'demonstration'
const DEMO_NOTE = 'Version de démonstration du site (remise à neuf toutes les 3 heures)'
const DEMO_USER = 'visiteur.demo@iam-invoicer.exemple'
const RESET_MS = 3 * 3600_000

function day(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

const json = (v: unknown) => JSON.stringify(v)

/** Remplit la société de démonstration (base neuve) ; rend son administrateur. */
export async function seedDemo(db: Db): Promise<SessionUser> {
  const user = await setup({ db, user: null }, {
    company: { name: 'Faso Distribution SARL (démonstration)', phone: '25 30 12 34', email: 'contact@fasodistribution.exemple', city: 'Ouagadougou' },
    username: DEMO_USER,
    full_name: 'Visiteur Démo',
    password: randomBytes(18).toString('base64url')
  })
  const settings: Record<string, unknown> = {
    demo_mode: '1',
    secef_mode: 'simulation',
    activity: 'Distribution de matériel informatique, bureautique et énergie solaire',
    address: 'Avenue Kwame Nkrumah, secteur 4, Ouagadougou',
    tax_id: '00012345X',
    rccm: 'BF-OUA-2019-B-04512',
    regime_fiscal: 'RNI',
    division_fiscale: 'DME Ouaga I',
    capital: '10 000 000 FCFA',
    bank_name: 'Coris Bank International',
    bank_account: 'BF042 01001 012345678901 23',
    doc_color: '#1d4ed8',
    invoice_footer: 'Société fictive de la version de démonstration d’IAM INVOICER.',
    signatory_name: 'Visiteur Démo',
    signatory_title: 'Gérant'
  }
  for (const [k, v] of Object.entries(settings)) await db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, json(v)])
  const ctx: Ctx = { db, user }

  // ── Clients et fournisseurs ──
  const party = async (kind: 'client' | 'supplier', name: string, contact: string, phone: string, city: string, terms = 30, extra: Record<string, unknown> = {}) =>
    (await saveParty(ctx, { kind, name, contact, phone, email: `contact@${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '')}.exemple`, city, payment_terms: terms, ...extra })).id as number
  const clients = {
    sonapost: await party('client', 'Faso Logistique', 'Mme Aminata Kaboré', '25 33 44 55', 'Ouagadougou', 30, { tax_id: '00045678B', address: 'Zone industrielle de Kossodo' }),
    lycee: await party('client', 'Lycée privé Wend-Panga', 'M. Adama Zoungrana', '25 36 48 00', 'Ouagadougou', 15),
    cabinet: await party('client', 'Cabinet Faso Audit', 'M. Jean-Baptiste Somé', '25 37 88 99', 'Ouagadougou', 30, { tax_id: '00078123K' }),
    hotel: await party('client', 'Hôtel Les Palmiers', 'Mme Fatimata Compaoré', '20 97 11 22', 'Bobo-Dioulasso', 45),
    ong: await party('client', 'ONG Teel Taaba', 'M. Issouf Sawadogo', '25 41 20 30', 'Koudougou', 30),
    pharma: await party('client', 'Pharmacie du Progrès', 'Dr Awa Ouédraogo', '25 31 65 43', 'Ouagadougou', 0),
    mairie: await party('client', 'Mairie de Saaba', 'Service technique', '25 50 12 12', 'Saaba', 60),
    boutique: await party('client', 'Boutique Wendkuuni', 'M. Salif Ouattara', '70 88 77 66', 'Ouagadougou', 0)
  }
  const suppliers = {
    cfao: await party('supplier', 'Afrique Informatique Import', 'Service commercial', '25 30 55 66', 'Ouagadougou', 30),
    solaire: await party('supplier', 'Sahel Solaire Distribution', 'M. Moussa Ilboudo', '25 38 99 00', 'Ouagadougou', 30),
    papeterie: await party('supplier', 'Librairie Jeunesse d’Afrique', 'Comptoir pro', '25 30 25 25', 'Ouagadougou', 15)
  }

  // ── Articles et prestations ──
  const product = async (name: string, category: string, sale: number, purchase: number, kind: 'produit' | 'prestation' = 'produit', min = 2, unit = '') =>
    (await saveProduct(ctx, { name, category, kind, sale_price: sale, purchase_price: purchase, tva_rate: 18, min_stock: min, unit })).id as number
  const p = {
    laptop: await product('Ordinateur portable HP ProBook 450', 'Informatique', 485_000, 398_000),
    desktop: await product('Ordinateur de bureau Dell OptiPlex', 'Informatique', 420_000, 345_000),
    printer: await product('Imprimante laser Canon i-SENSYS', 'Bureautique', 165_000, 128_000),
    toner: await product('Cartouche de toner Canon 052', 'Consommables', 48_000, 36_000, 'produit', 5),
    paper: await product('Rame de papier A4 80 g', 'Consommables', 3_500, 2_600, 'produit', 20, 'rame'),
    ups: await product('Onduleur 1500 VA', 'Énergie', 95_000, 72_000),
    panel: await product('Panneau solaire 300 W', 'Énergie', 135_000, 104_000),
    battery: await product('Batterie solaire 200 Ah', 'Énergie', 245_000, 196_000),
    install: await product('Installation et mise en service', 'Services', 75_000, 0, 'prestation', 0, 'forfait'),
    maintenance: await product('Contrat de maintenance annuel', 'Services', 360_000, 0, 'prestation', 0, 'an'),
    training: await product('Formation bureautique (journée)', 'Services', 120_000, 0, 'prestation', 0, 'jour')
  }
  const price: Record<number, number> = {}
  const name: Record<number, string> = {}
  for (const [k, id] of Object.entries(p)) {
    const row = await db.one<{ sale_price: number; name: string }>('SELECT sale_price::float AS sale_price, name FROM products WHERE id = $1', [id])
    price[id] = row!.sale_price
    name[id] = row!.name ?? k
  }
  const line = (id: number, quantity: number, discount = 0) => ({ product_id: id, description: name[id], quantity, unit_price: price[id], discount, tva_rate: 18 })

  // ── Achats : stock de départ (factures fournisseurs validées et réglées) ──
  const buy = async (supplier: number, date: string, lines: [number, number, number][], paid: boolean) => {
    const { id } = await saveDocument(ctx, { type: 'FF', party_id: supplier, date, reference: `FRN-${Math.floor(Math.random() * 90000) + 10000}`, lines: lines.map(([pid, qty, cost]) => ({ product_id: pid, description: name[pid], quantity: qty, unit_price: cost, tva_rate: 18 })) })
    await validateDocument(ctx, { id })
    if (paid) {
      const d = await db.one<{ total_ttc: number }>('SELECT total_ttc::float AS total_ttc FROM documents WHERE id = $1', [id])
      await addPayment(ctx, { document_id: id, amount: d!.total_ttc, date, method: 'Virement', reference: `VIR-${date.replace(/-/g, '')}` })
    }
    return id
  }
  await buy(suppliers.cfao, day(-75), [[p.laptop, 12, 398_000], [p.desktop, 8, 345_000], [p.printer, 6, 128_000], [p.toner, 30, 36_000]], true)
  await buy(suppliers.solaire, day(-70), [[p.ups, 15, 72_000], [p.panel, 24, 104_000], [p.battery, 10, 196_000]], true)
  await buy(suppliers.papeterie, day(-72), [[p.paper, 200, 2_600]], false)

  // ── Ventes du trimestre : devis, factures, règlements (dans l'ordre des dates) ──
  const sell = async (type: 'DEV' | 'FAC', client: number, date: string, lines: ReturnType<typeof line>[], opts: { validate?: boolean; pay?: number | 'all'; method?: string; payDate?: string } = {}) => {
    const { id } = await saveDocument(ctx, { type, party_id: client, date, lines })
    if (opts.validate !== false) await validateDocument(ctx, { id })
    if (opts.pay) {
      const d = await db.one<{ total_ttc: number }>('SELECT total_ttc::float AS total_ttc FROM documents WHERE id = $1', [id])
      const amount = opts.pay === 'all' ? d!.total_ttc : opts.pay
      await addPayment(ctx, { document_id: id, amount, date: opts.payDate ?? date, method: opts.method ?? 'Virement', reference: opts.method === 'Espèces' ? '' : `PAY-${id}` })
    }
    return id
  }
  await sell('FAC', clients.cabinet, day(-62), [line(p.laptop, 3), line(p.install, 1)], { pay: 'all', payDate: day(-55) })
  await sell('FAC', clients.pharma, day(-58), [line(p.printer, 1), line(p.toner, 2), line(p.paper, 10)], { pay: 'all', method: 'Orange Money' })
  const devisLycee = await sell('DEV', clients.lycee, day(-52), [line(p.desktop, 4), line(p.ups, 4), line(p.training, 2)])
  await sell('FAC', clients.hotel, day(-48), [line(p.panel, 8), line(p.battery, 4), line(p.install, 1)], { pay: 1_200_000, payDate: day(-40) })
  // Le devis du lycée accepté devient une facture
  const factLycee = (await convertDocument(ctx, { id: devisLycee, to: 'FAC' })).id
  await db.query('UPDATE documents SET date = $2 WHERE id = $1', [factLycee, day(-45)])
  await validateDocument(ctx, { id: factLycee })
  await sell('FAC', clients.boutique, day(-38), [line(p.paper, 40), line(p.toner, 3)], { pay: 'all', method: 'Espèces' })
  await sell('FAC', clients.ong, day(-30), [line(p.laptop, 2), line(p.printer, 1), line(p.maintenance, 1)], { pay: 'all', method: 'Virement', payDate: day(-12) })
  await sell('FAC', clients.mairie, day(-24), [line(p.panel, 6), line(p.battery, 3), line(p.install, 1)])
  await sell('FAC', clients.sonapost, day(-16), [line(p.desktop, 2), line(p.ups, 2)], { pay: 300_000, payDate: day(-6) })
  await sell('FAC', clients.cabinet, day(-9), [line(p.maintenance, 1)], { pay: 'all', method: 'Chèque', payDate: day(-3) })
  await sell('FAC', clients.pharma, day(-4), [line(p.paper, 15), line(p.toner, 1)])
  await sell('DEV', clients.hotel, day(-3), [line(p.panel, 12), line(p.battery, 6), line(p.install, 2)])
  await sell('DEV', clients.ong, day(-1), [line(p.training, 3)], { validate: false })

  // ── Dépenses de l'entreprise ──
  const spend = async (category: string, label: string, amount: number, date: string, method = 'Espèces') => {
    const e = await saveExpense(ctx, { category, label, amount, date, method })
    if (e.status !== 'approuvee' && e.status !== 'payee') await decideExpense(ctx, { id: e.id, approve: true }).catch(() => {})
    await payExpense(ctx, { id: e.id, date, method }).catch(() => {})
  }
  await spend('loyer', 'Loyer du magasin (mois en cours)', 350_000, day(-20), 'Virement')
  await spend('transport', 'Livraison du matériel à Bobo-Dioulasso', 65_000, day(-47))
  await spend('carburant', 'Carburant des tournées de livraison', 48_000, day(-10), 'Orange Money')
  await spend('electricite', 'Facture SONABEL du magasin', 87_500, day(-26))
  await spend('mission', 'Mission d’installation à Koudougou (2 nuits)', 54_000, day(-29))
  return user
}

/** La société de démonstration : créée à la demande, recréée quand elle a plus de 3 heures. */
export class InvoicerDemo {
  private busy: Promise<void> | null = null

  constructor(private manager: TenantManager, private forget: (slug: string) => void) {}

  start() {
    const tick = () => void this.refresh().catch((e) => console.warn('Démonstration :', e?.message ?? e))
    setTimeout(tick, 15_000).unref?.()
    setInterval(tick, 10 * 60_000).unref?.()
  }

  /** Une base n'est remise à neuf que si c'est bien la démonstration (marque et réglage demo_mode). */
  private async isDemoTenant(): Promise<boolean> {
    const t = await this.manager.get(DEMO_SLUG)
    if (!t || t.notes !== DEMO_NOTE) return false
    const db = await this.manager.db(t)
    return (await db.one<{ value: string }>("SELECT value FROM settings WHERE key = 'demo_mode'"))?.value === '"1"'
  }

  async refresh(force = false): Promise<void> {
    if (this.busy) return this.busy
    const t = await this.manager.get(DEMO_SLUG)
    if (t && !force && Date.now() - new Date(t.created_at).getTime() < RESET_MS) return
    this.busy = (async () => {
      if (t) {
        if (!(await this.isDemoTenant())) throw new Error(`la base « ${DEMO_SLUG} » n'est pas la démonstration : elle n'est pas touchée`)
        this.forget(DEMO_SLUG)
        await this.manager.remove(DEMO_SLUG)
      }
      await this.manager.create({ name: 'Faso Distribution SARL (démonstration)', slug: DEMO_SLUG, notes: DEMO_NOTE })
      try {
        await seedDemo(await this.manager.db((await this.manager.get(DEMO_SLUG))!))
        await this.manager.consumeSetupCode(DEMO_SLUG)
      } catch (e) {
        this.forget(DEMO_SLUG)
        await this.manager.remove(DEMO_SLUG).catch(() => {})
        throw e
      }
    })().finally(() => {
      this.busy = null
    })
    return this.busy
  }

  /** Session d'un visiteur dans la société de démonstration. */
  async session(device: string) {
    await this.refresh()
    const t = (await this.manager.get(DEMO_SLUG))!
    const db = await this.manager.db(t)
    const user = await db.one<{ id: number }>('SELECT id FROM users WHERE username = $1', [DEMO_USER])
    if (!user) throw new Error('compte de démonstration absent')
    const token = await createToken(db, user.id, (device || 'Démonstration (navigateur)').slice(0, 200))
    return { slug: DEMO_SLUG, path: `/t/${DEMO_SLUG}`, token, reset_at: new Date(new Date(t.created_at).getTime() + RESET_MS).toISOString() }
  }
}
