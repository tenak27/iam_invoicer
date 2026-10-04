// Application web d'un client hébergé (/t/<client>/) dans un vrai navigateur :
// première configuration avec le code d'activation, puis travail isolé par client.
// Lancement : npm run build:web && E2E_CLOUD=1 npx vitest run tests/cloud-web.e2e.test.ts
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { createHandler } from '../src/server/app'
import { createCloudHandler } from '../src/server/cloud'
import { TenantManager, type Provisioner } from '../src/server/tenants'

const RUN = !!process.env.E2E_CLOUD
const dbs = new Map<string, { password: string; db: Db | null }>()
const prov: Provisioner = {
  endpoint: () => ({ host: 'db', port: 5432 }),
  protectDatabase: async () => {},
  createDatabase: async (n, p) => void dbs.set(n, { password: p, db: null }),
  setPassword: async (n, p) => void (dbs.get(n)!.password = p),
  dropDatabase: async (n) => void dbs.delete(n),
  databaseSize: async () => 1,
  open: async (n, p) => {
    const e = dbs.get(n)!
    if (e.password !== p) throw new Error('refusé')
    e.db ??= await openDb({ mode: 'local' })
    return { ...e.db, close: async () => {} }
  }
}

describe.skipIf(!RUN)('Application web d’un client hébergé', () => {
  let server: Server
  let base = ''
  let manager: TenantManager
  let control: Db
  let browser: any

  beforeAll(async () => {
    control = await openDb({ mode: 'local' })
    manager = new TenantManager(control, prov)
    await manager.init()
    const webRoot = join(process.cwd(), 'out/web')
    server = createServer(createCloudHandler({ root: createHandler({ db: control, version: 't', webRoot }), manager, adminToken: 'z'.repeat(40), shared: { version: 't', webRoot } }))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const { chromium } = createRequire(join(process.cwd(), 'package.json'))('playwright')
    browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined })
  }, 60_000)
  afterAll(async () => {
    await browser?.close()
    await new Promise((r) => server?.close(r))
    await manager?.closeAll()
  })

  it('configuration avec le code d’activation, puis données propres au client', async () => {
    const a = await manager.create({ name: 'Boutique Alpha' })
    const b = await manager.create({ name: 'Boutique Beta' })
    const page = await browser.newPage()
    await page.goto(`${base}/t/${a.slug}/`)
    await page.getByLabel("Code d'activation").waitFor({ timeout: 20_000 })
    await page.getByLabel('Raison sociale').fill('Boutique Alpha SARL')
    await page.getByLabel('Nom complet').fill('Awa Alpha')
    await page.locator('input[type=password]').nth(0).fill('secret123')
    await page.locator('input[type=password]').nth(1).fill('secret123')
    // Mauvais code : refus affiché
    await page.getByLabel("Code d'activation").fill('AAAA-BBBB-CCCC')
    await page.getByRole('button', { name: 'Terminer la configuration' }).click()
    await page.getByText(/Code d'activation incorrect/).waitFor()
    await page.getByLabel("Code d'activation").fill(a.setup_code)
    await page.getByRole('button', { name: 'Terminer la configuration' }).click()
    await page.locator('.content').waitFor({ timeout: 20_000 })
    // L'application parle bien à la base du client (adresse /t/<client>)
    const st = await page.evaluate(() => (window as any).erp.status())
    expect(st.serverUrl ?? '').toContain(`/t/${a.slug}`)
    // Données : la base A a sa société, la base B est vierge
    const ta = (await manager.get(a.slug))!
    const tb = (await manager.get(b.slug))!
    expect((await (await manager.db(ta)).one<{ n: number }>('SELECT COUNT(*)::int AS n FROM users'))!.n).toBe(1)
    expect((await (await manager.db(tb)).one<{ n: number }>('SELECT COUNT(*)::int AS n FROM users'))!.n).toBe(0)
    // Le client B, dans le même navigateur, arrive sur SA configuration (session de A non réutilisée)
    await page.goto(`${base}/t/${b.slug}/`)
    await page.getByLabel("Code d'activation").waitFor({ timeout: 20_000 })
    await page.screenshot({ path: join(process.cwd(), 'e2e-out', 'cloud-setup-b.png') }).catch(() => {})
  }, 120_000)
})
