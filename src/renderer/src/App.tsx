import { useCallback, useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { api } from './api'
import { setDefaultCurrency } from '@shared/format'
import { setRolePermissions } from '@shared/domain'
import { countryProfile } from '@shared/countries'
import { ConfirmHost, Loading, notify, Toaster } from './components/ui'
import { Layout } from './components/Layout'
import { SessionContext, type Session, type User } from './session'
import { DbConfigScreen, LoginScreen, SetupScreen } from './pages/Auth'
import { Dashboard } from './pages/Dashboard'
import { ImportPage } from './pages/Import'
import { LicencePage } from './pages/Licence'
import { RolesPage } from './pages/Roles'
import { RecurringPage } from './pages/Recurring'
import { BalanceSheet, Declarations } from './pages/Statements'
import { DocumentList } from './pages/DocumentList'
import { DocumentEditor } from './pages/DocumentEditor'
import { PartyDetail, PartyList } from './pages/Parties'
import { Products } from './pages/Products'
import { Inventory, StockMovements, StockState } from './pages/Stock'
import { Payments } from './pages/Payments'
import { Reports } from './pages/Reports'
import { AuditLog, CompanySettingsPage, MyAccount, Users } from './pages/Admin'
import { CashRegister, CashSessionDetail, CashSessions } from './pages/Cash'
import { Accounts, Balance, Entries, IncomeStatement, Ledger } from './pages/Accounting'
import { can } from '@shared/domain'
import { MessagesLog, MessageTemplates } from './pages/Messages'
import { StockAdvanced } from './pages/StockAdvanced'
import { HrPage } from './pages/Hr'
import { CrmPage } from './pages/Crm'
import { ProjectDetail, ProjectsPage } from './pages/Projects'
import { AssetsPage } from './pages/Assets'
import { BudgetPage } from './pages/Budget'
import { homeFor } from './components/Layout'
import { LicensingPage } from './pages/Licensing'

type Phase = 'loading' | 'db-error' | 'setup' | 'login' | 'ready'

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [dbError, setDbError] = useState<string | null>(null)
  const [dbMode, setDbMode] = useState<DataMode>('local')
  const [serverUrl, setServerUrl] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [company, setCompany] = useState<Session['company'] | null>(null)
  const [licence, setLicence] = useState<Session['licence']>(null)

  /** Factures récurrentes arrivées à échéance : créées à la connexion. */
  const runRecurring = useCallback(async (u: User) => {
    if (!can(u.role, 'sales')) return
    const r = await api<any>('recurring.runDue').catch(() => null)
    if (r?.created?.length) notify(`${r.created.length} facture(s) récurrente(s) créée(s) pour les échéances du jour.`, 'success')
  }, [])

  /** Photo de profil de l'utilisateur connecté. */
  const loadProfile = useCallback(async (u: User) => {
    const p = await api<any>('auth.profile').catch(() => null)
    setUser({ ...u, avatar: p?.avatar ?? '' })
  }, [])

  const refreshCompany = useCallback(async () => {
    const [c, lic, perms] = await Promise.all([api<any>('settings.get'), api<any>('licence.status').catch(() => null), api<any>('roles.get').catch(() => null)])
    if (perms) setRolePermissions(perms.current)
    setDefaultCurrency(c.currency, countryProfile(c.country_code, c.country).currencyWords)
    setCompany(c)
    setLicence(lic)
  }, [])

  const boot = useCallback(async () => {
    const st = await window.erp.status()
    setDbMode(st.dbMode)
    setServerUrl(st.serverUrl)
    if (!st.dbReady) {
      setDbError(st.dbError)
      setPhase('db-error')
      return
    }
    if (!st.offline && (await api<boolean>('auth.needsSetup'))) {
      setPhase('setup')
      return
    }
    if (st.user) {
      setUser(st.user)
      loadProfile(st.user)
      runRecurring(st.user)
      await refreshCompany()
      setPhase('ready')
    } else setPhase('login')
  }, [refreshCompany])

  useEffect(() => {
    boot().catch((e) => {
      setDbError(String(e))
      setPhase('db-error')
    })
  }, [boot])

  const onLogin = async (u: User) => {
    setUser(u)
    loadProfile(u)
    runRecurring(u)
    await refreshCompany()
    setPhase('ready')
  }

  const logout = async () => {
    await window.erp.logout()
    setUser(null)
    setPhase('login')
  }

  return (
    <>
      <Toaster />
      <ConfirmHost />
      {phase === 'loading' && <Loading />}
      {phase === 'db-error' && <DbConfigScreen error={dbError} />}
      {phase === 'setup' && <SetupScreen onDone={onLogin} />}
      {phase === 'login' && <LoginScreen onLogin={onLogin} dbMode={dbMode} serverUrl={serverUrl} />}
      {phase === 'ready' && user && company && (
        <SessionContext.Provider value={{ user, company, dbMode, serverUrl, logout, refreshCompany, licence, updateUser: (patch) => setUser((u) => (u ? { ...u, ...patch } : u)) }}>
          <HashRouter>
            <Layout>
              <Routes>
                <Route path="/" element={can(user.role, 'dashboard') ? <Dashboard /> : <Navigate to={homeFor(user.role)} />} />
                <Route path="/docs/:type" element={<DocumentList />} />
                <Route path="/docs/:type/new" element={<DocumentEditor />} />
                <Route path="/doc/:id" element={<DocumentEditor />} />
                <Route path="/clients" element={<PartyList key="client" kind="client" />} />
                <Route path="/suppliers" element={<PartyList key="supplier" kind="supplier" />} />
                <Route path="/party/:id" element={<PartyDetail />} />
                <Route path="/products" element={<Products />} />
                <Route path="/stock" element={<StockState />} />
                <Route path="/stock/movements" element={<StockMovements />} />
                <Route path="/stock/inventory" element={<Inventory />} />
                <Route path="/payments" element={<Payments />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/caisse" element={<CashRegister />} />
                <Route path="/caisse/sessions" element={<CashSessions />} />
                <Route path="/caisse/session/:id" element={<CashSessionDetail />} />
                <Route path="/compta" element={<Entries />} />
                <Route path="/compta/grand-livre" element={<Ledger />} />
                <Route path="/compta/balance" element={<Balance />} />
                <Route path="/compta/resultat" element={<IncomeStatement />} />
                <Route path="/compta/comptes" element={<Accounts />} />
                <Route path="/compta/bilan" element={<BalanceSheet />} />
                <Route path="/declarations" element={<Declarations />} />
                <Route path="/messages" element={<MessagesLog />} />
                <Route path="/stock/depots" element={<StockAdvanced />} />
                <Route path="/rh" element={<HrPage />} />
                <Route path="/crm" element={<CrmPage />} />
                <Route path="/projets" element={<ProjectsPage />} />
                <Route path="/projets/:id" element={<ProjectDetail />} />
                <Route path="/immobilisations" element={<AssetsPage />} />
                <Route path="/budget" element={<BudgetPage />} />
                <Route path="/messages/modeles" element={<MessageTemplates />} />
                <Route path="/settings" element={<CompanySettingsPage />} />
                <Route path="/users" element={<Users />} />
                <Route path="/import" element={<ImportPage />} />
                <Route path="/licence" element={<LicencePage />} />
                <Route path="/roles" element={<RolesPage />} />
                <Route path="/licences-emises" element={<LicensingPage />} />
                <Route path="/recurrentes" element={<RecurringPage />} />
                <Route path="/audit" element={<AuditLog />} />
                <Route path="/account" element={<MyAccount />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </Layout>
          </HashRouter>
        </SessionContext.Provider>
      )}
    </>
  )
}
