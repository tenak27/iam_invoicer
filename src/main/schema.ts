// Migrations successives du schéma. Ne jamais modifier une migration déjà
// livrée : ajouter une nouvelle entrée à la fin du tableau.
// Les dates métier sont stockées en texte AAAA-MM-JJ.

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','commercial','magasinier','comptable')),
    password_hash TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE parties (
    id SERIAL PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('client','supplier')),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    contact TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    tax_id TEXT NOT NULL DEFAULT '',
    rccm TEXT NOT NULL DEFAULT '',
    payment_terms INT NOT NULL DEFAULT 30,
    notes TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (kind, code)
  );

  CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('produit','prestation')),
    ref TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'unité',
    sale_price DOUBLE PRECISION NOT NULL DEFAULT 0,
    purchase_price DOUBLE PRECISION NOT NULL DEFAULT 0,
    tva_rate DOUBLE PRECISION NOT NULL DEFAULT 18,
    stock_qty DOUBLE PRECISION NOT NULL DEFAULT 0,
    avg_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    min_stock DOUBLE PRECISION NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('DEV','BL','FAC','AV','BC','BR','FF')),
    number TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon','valide','annule')),
    party_id INT NOT NULL REFERENCES parties(id),
    date TEXT NOT NULL,
    due_date TEXT,
    reference TEXT NOT NULL DEFAULT '',
    source_id INT REFERENCES documents(id),
    notes TEXT NOT NULL DEFAULT '',
    total_ht DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_tva DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_ttc DOUBLE PRECISION NOT NULL DEFAULT 0,
    stock_applied BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INT REFERENCES users(id),
    validated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX documents_type_idx ON documents(type, date);
  CREATE INDEX documents_party_idx ON documents(party_id);

  CREATE TABLE document_lines (
    id SERIAL PRIMARY KEY,
    document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    position INT NOT NULL,
    product_id INT REFERENCES products(id),
    description TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL,
    unit_price DOUBLE PRECISION NOT NULL,
    discount DOUBLE PRECISION NOT NULL DEFAULT 0,
    tva_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_ht DOUBLE PRECISION NOT NULL
  );
  CREATE INDEX document_lines_doc_idx ON document_lines(document_id);

  CREATE TABLE stock_movements (
    id SERIAL PRIMARY KEY,
    product_id INT NOT NULL REFERENCES products(id),
    date TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL,
    unit_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    kind TEXT NOT NULL,
    document_id INT REFERENCES documents(id),
    note TEXT NOT NULL DEFAULT '',
    user_id INT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX stock_movements_product_idx ON stock_movements(product_id, date);

  CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN ('in','out')),
    party_id INT NOT NULL REFERENCES parties(id),
    document_id INT REFERENCES documents(id),
    date TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    user_id INT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX payments_doc_idx ON payments(document_id);

  CREATE TABLE sequences (
    key TEXT PRIMARY KEY,
    value INT NOT NULL
  );

  CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id INT,
    details TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
  `,
  // v2 — IAM INVOICER : comptabilité SYSCOHADA, caisse, rôle caissier, sessions du serveur web.
  `
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','commercial','magasinier','comptable','caissier'));

  CREATE TABLE accounts (
    number TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
  );

  INSERT INTO accounts (number, label) VALUES
    ('101', 'Capital social'),
    ('108', 'Compte de l''exploitant'),
    ('162', 'Emprunts auprès des établissements de crédit'),
    ('244', 'Matériel et mobilier'),
    ('245', 'Matériel de transport'),
    ('311', 'Marchandises'),
    ('401', 'Fournisseurs'),
    ('411', 'Clients'),
    ('421', 'Personnel, avances et acomptes'),
    ('422', 'Personnel, rémunérations dues'),
    ('431', 'Sécurité sociale (CNSS)'),
    ('441', 'État, impôt sur les bénéfices'),
    ('4431', 'État, TVA facturée sur ventes'),
    ('4452', 'État, TVA récupérable sur achats'),
    ('447', 'État, impôts retenus à la source'),
    ('471', 'Débiteurs et créditeurs divers'),
    ('521', 'Banques'),
    ('552', 'Monnaie électronique (mobile money)'),
    ('571', 'Caisse'),
    ('585', 'Virements de fonds'),
    ('601', 'Achats de marchandises'),
    ('604', 'Achats de matières et fournitures consommables'),
    ('605', 'Autres achats'),
    ('6051', 'Fournitures non stockables – Eau'),
    ('6052', 'Fournitures non stockables – Électricité'),
    ('6053', 'Fournitures non stockables – Carburant et autres énergies'),
    ('6055', 'Fournitures de bureau'),
    ('618', 'Autres frais de transport'),
    ('622', 'Locations et charges locatives'),
    ('624', 'Entretien, réparations et maintenance'),
    ('625', 'Primes d''assurance'),
    ('627', 'Publicité et relations publiques'),
    ('628', 'Frais de télécommunications'),
    ('631', 'Frais bancaires'),
    ('632', 'Honoraires et conseils'),
    ('638', 'Autres charges externes'),
    ('641', 'Impôts et taxes directs'),
    ('646', 'Droits d''enregistrement et de timbre'),
    ('658', 'Charges diverses'),
    ('661', 'Rémunérations directes versées au personnel'),
    ('664', 'Charges sociales'),
    ('671', 'Intérêts des emprunts'),
    ('701', 'Ventes de marchandises'),
    ('706', 'Services vendus'),
    ('707', 'Produits accessoires'),
    ('758', 'Produits divers'),
    ('771', 'Intérêts de prêts');

  CREATE TABLE journal_entries (
    id SERIAL PRIMARY KEY,
    journal TEXT NOT NULL,
    number TEXT NOT NULL UNIQUE,
    date TEXT NOT NULL,
    label TEXT NOT NULL,
    source TEXT,
    source_id INT,
    user_id INT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX journal_entries_source_idx ON journal_entries(source, source_id);
  CREATE INDEX journal_entries_date_idx ON journal_entries(date);

  CREATE TABLE journal_lines (
    id SERIAL PRIMARY KEY,
    entry_id INT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    position INT NOT NULL,
    account TEXT NOT NULL REFERENCES accounts(number),
    party_id INT REFERENCES parties(id),
    label TEXT NOT NULL DEFAULT '',
    debit DOUBLE PRECISION NOT NULL DEFAULT 0,
    credit DOUBLE PRECISION NOT NULL DEFAULT 0
  );
  CREATE INDEX journal_lines_entry_idx ON journal_lines(entry_id);
  CREATE INDEX journal_lines_account_idx ON journal_lines(account);

  CREATE TABLE cash_sessions (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    opening_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ouverte' CHECK (status IN ('ouverte','fermee')),
    closed_at TIMESTAMPTZ,
    expected_amount DOUBLE PRECISION,
    counted_amount DOUBLE PRECISION,
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE UNIQUE INDEX cash_sessions_open_idx ON cash_sessions(user_id) WHERE status = 'ouverte';

  CREATE TABLE cash_movements (
    id SERIAL PRIMARY KEY,
    session_id INT NOT NULL REFERENCES cash_sessions(id),
    kind TEXT NOT NULL CHECK (kind IN ('entree','sortie')),
    amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
    account TEXT NOT NULL REFERENCES accounts(number),
    label TEXT NOT NULL,
    user_id INT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX cash_movements_session_idx ON cash_movements(session_id);

  ALTER TABLE payments ADD COLUMN cash_session_id INT REFERENCES cash_sessions(id);
  CREATE INDEX payments_cash_session_idx ON payments(cash_session_id);

  CREATE TABLE auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device TEXT NOT NULL DEFAULT '',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
  `,
  // v3 — communications (e-mail, SMS), modèles de messages, signatures électroniques.
  `
  CREATE TABLE secrets (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE message_templates (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
    name TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  INSERT INTO message_templates (code, channel, name, subject, body) VALUES
    ('doc_email', 'email', 'Envoi d''un document', '{type} {numero} — {societe}',
     'Bonjour {client},' || chr(10) || chr(10) || 'Veuillez trouver ci-joint notre {type_min} n° {numero} du {date}, d''un montant de {montant}.' || chr(10) || chr(10) || 'Nous restons à votre disposition pour toute question.' || chr(10) || chr(10) || 'Cordialement,' || chr(10) || '{utilisateur}' || chr(10) || '{societe} — {telephone}'),
    ('reminder_email', 'email', 'Relance de paiement', 'Rappel : facture {numero} échue le {echeance}',
     'Bonjour {client},' || chr(10) || chr(10) || 'Sauf erreur de notre part, la facture n° {numero} du {date} reste impayée pour un montant de {reste}. Son échéance était le {echeance}.' || chr(10) || chr(10) || 'Merci de procéder au règlement par virement, Orange Money ou Moov Money. Si le paiement a déjà été effectué, veuillez ne pas tenir compte de ce message.' || chr(10) || chr(10) || 'Cordialement,' || chr(10) || '{societe} — {telephone}'),
    ('sign_email', 'email', 'Demande de signature', 'Signature de votre {type_min} {numero}',
     'Bonjour {client},' || chr(10) || chr(10) || 'Merci de consulter et signer en ligne notre {type_min} n° {numero} d''un montant de {montant} :' || chr(10) || '{lien}' || chr(10) || chr(10) || 'Ce lien est valable 30 jours.' || chr(10) || chr(10) || 'Cordialement,' || chr(10) || '{societe}'),
    ('doc_sms', 'sms', 'Document envoyé (SMS)', '',
     '{societe} : votre {type_min} {numero} de {montant} est disponible. Merci de votre confiance.'),
    ('reminder_sms', 'sms', 'Relance de paiement (SMS)', '',
     '{societe} : rappel, la facture {numero} ({reste}) était due le {echeance}. Paiement possible par Orange Money ou Moov Money. Merci.'),
    ('sign_sms', 'sms', 'Demande de signature (SMS)', '',
     '{societe} : merci de signer votre {type_min} {numero} ici : {lien}');

  CREATE TABLE message_log (
    id SERIAL PRIMARY KEY,
    channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('envoye','echec')),
    error TEXT NOT NULL DEFAULT '',
    document_id INT REFERENCES documents(id) ON DELETE SET NULL,
    party_id INT REFERENCES parties(id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'manuel',
    user_id INT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX message_log_created_idx ON message_log(created_at);
  CREATE INDEX message_log_document_idx ON message_log(document_id);

  CREATE TABLE signatures (
    id SERIAL PRIMARY KEY,
    document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    signer_name TEXT NOT NULL,
    signer_role TEXT NOT NULL DEFAULT 'client',
    image TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('sur_place','a_distance')),
    ip TEXT NOT NULL DEFAULT '',
    device TEXT NOT NULL DEFAULT '',
    user_id INT REFERENCES users(id),
    signed_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX signatures_document_idx ON signatures(document_id);

  CREATE TABLE sign_requests (
    token_hash TEXT PRIMARY KEY,
    document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente','signe','annule')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_by INT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
  `,
  // v4 — ERP complet : stock multi-dépôts, lots et séries, paie et RH, CRM, projets,
  // immobilisations, budgets et trésorerie prévisionnelle, facture certifiée, hors ligne.
  `
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','commercial','magasinier','comptable','caissier','rh'));

  CREATE TABLE warehouses (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE
  );
  INSERT INTO warehouses (code, name) VALUES ('PRINCIPAL', 'Dépôt principal');

  CREATE TABLE product_stock (
    product_id INT NOT NULL REFERENCES products(id),
    warehouse_id INT NOT NULL REFERENCES warehouses(id),
    qty DOUBLE PRECISION NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, warehouse_id)
  );
  INSERT INTO product_stock (product_id, warehouse_id, qty) SELECT id, 1, stock_qty FROM products WHERE kind = 'produit';

  ALTER TABLE stock_movements ADD COLUMN warehouse_id INT NOT NULL DEFAULT 1 REFERENCES warehouses(id);
  ALTER TABLE products ADD COLUMN tracking TEXT NOT NULL DEFAULT 'aucun' CHECK (tracking IN ('aucun','lot','serie'));
  ALTER TABLE document_lines ADD COLUMN lot_refs TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN warehouse_id INT NOT NULL DEFAULT 1 REFERENCES warehouses(id);

  CREATE TABLE stock_lots (
    id SERIAL PRIMARY KEY,
    product_id INT NOT NULL REFERENCES products(id),
    warehouse_id INT NOT NULL REFERENCES warehouses(id),
    lot TEXT NOT NULL,
    expiry TEXT,
    qty DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, warehouse_id, lot)
  );

  CREATE TABLE stock_transfers (
    id SERIAL PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    date TEXT NOT NULL,
    from_warehouse INT NOT NULL REFERENCES warehouses(id),
    to_warehouse INT NOT NULL REFERENCES warehouses(id),
    note TEXT NOT NULL DEFAULT '',
    user_id INT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE stock_transfer_lines (
    id SERIAL PRIMARY KEY,
    transfer_id INT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(id),
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    lot TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    matricule TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    job TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'non_cadre' CHECK (category IN ('cadre','non_cadre')),
    hire_date TEXT NOT NULL,
    exit_date TEXT,
    base_salary DOUBLE PRECISION NOT NULL DEFAULT 0,
    housing DOUBLE PRECISION NOT NULL DEFAULT 0,
    transport DOUBLE PRECISION NOT NULL DEFAULT 0,
    function_allowance DOUBLE PRECISION NOT NULL DEFAULT 0,
    other_allowances DOUBLE PRECISION NOT NULL DEFAULT 0,
    family_charges INT NOT NULL DEFAULT 0,
    cnss_number TEXT NOT NULL DEFAULT '',
    payment_method TEXT NOT NULL DEFAULT 'Virement',
    bank_account TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    leave_adjust DOUBLE PRECISION NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE payroll_runs (
    id SERIAL PRIMARY KEY,
    period TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon','valide')),
    gross DOUBLE PRECISION NOT NULL DEFAULT 0,
    net DOUBLE PRECISION NOT NULL DEFAULT 0,
    employer_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    validated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE payslips (
    id SERIAL PRIMARY KEY,
    run_id INT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    employee_id INT NOT NULL REFERENCES employees(id),
    detail TEXT NOT NULL,
    gross DOUBLE PRECISION NOT NULL,
    taxable DOUBLE PRECISION NOT NULL,
    cnss_employee DOUBLE PRECISION NOT NULL,
    iuts DOUBLE PRECISION NOT NULL,
    other_deductions DOUBLE PRECISION NOT NULL DEFAULT 0,
    net DOUBLE PRECISION NOT NULL,
    cnss_employer DOUBLE PRECISION NOT NULL,
    UNIQUE (run_id, employee_id)
  );

  CREATE TABLE leaves (
    id SERIAL PRIMARY KEY,
    employee_id INT NOT NULL REFERENCES employees(id),
    kind TEXT NOT NULL CHECK (kind IN ('conge_paye','maladie','sans_solde','autre')),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    days DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL DEFAULT 'demande' CHECK (status IN ('demande','approuve','refuse')),
    note TEXT NOT NULL DEFAULT '',
    decided_by INT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE opportunities (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    party_id INT REFERENCES parties(id),
    prospect_name TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    probability INT NOT NULL DEFAULT 20,
    stage TEXT NOT NULL DEFAULT 'nouveau' CHECK (stage IN ('nouveau','qualifie','proposition','negociation','gagne','perdu')),
    expected_date TEXT,
    source TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    lost_reason TEXT NOT NULL DEFAULT '',
    owner_id INT REFERENCES users(id),
    quote_id INT REFERENCES documents(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE crm_activities (
    id SERIAL PRIMARY KEY,
    opportunity_id INT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('appel','reunion','email','visite','note','tache')),
    subject TEXT NOT NULL,
    due_date TEXT,
    done BOOLEAN NOT NULL DEFAULT FALSE,
    user_id INT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    party_id INT REFERENCES parties(id),
    status TEXT NOT NULL DEFAULT 'en_cours' CHECK (status IN ('prospect','en_cours','suspendu','termine','annule')),
    start_date TEXT,
    end_date TEXT,
    budget_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    budget_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
    hourly_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
    manager_id INT REFERENCES users(id),
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE documents ADD COLUMN project_id INT REFERENCES projects(id);
  CREATE TABLE time_entries (
    id SERIAL PRIMARY KEY,
    project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id),
    date TEXT NOT NULL,
    hours DOUBLE PRECISION NOT NULL CHECK (hours > 0),
    description TEXT NOT NULL,
    billable BOOLEAN NOT NULL DEFAULT TRUE,
    rate DOUBLE PRECISION NOT NULL DEFAULT 0,
    invoice_id INT REFERENCES documents(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX time_entries_project_idx ON time_entries(project_id, date);

  CREATE TABLE assets (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    account TEXT NOT NULL REFERENCES accounts(number),
    acquisition_date TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL CHECK (value > 0),
    residual DOUBLE PRECISION NOT NULL DEFAULT 0,
    duration_years INT NOT NULL CHECK (duration_years > 0),
    supplier TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'actif' CHECK (status IN ('actif','cede','rebut')),
    disposal_date TEXT,
    disposal_value DOUBLE PRECISION,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE asset_postings (
    asset_id INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    year INT NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    entry_id INT REFERENCES journal_entries(id) ON DELETE SET NULL,
    PRIMARY KEY (asset_id, year)
  );

  CREATE TABLE budget_lines (
    id SERIAL PRIMARY KEY,
    year INT NOT NULL,
    account TEXT NOT NULL,
    label TEXT NOT NULL,
    amounts TEXT NOT NULL,
    UNIQUE (year, account)
  );
  CREATE TABLE cash_forecasts (
    id SERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    label TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    recurrence TEXT NOT NULL DEFAULT 'aucune' CHECK (recurrence IN ('aucune','mensuelle')),
    end_date TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  ALTER TABLE documents ADD COLUMN secef_status TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN secef_code TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN secef_nim TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN secef_counters TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN secef_qr TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN secef_date TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN secef_error TEXT NOT NULL DEFAULT '';

  CREATE TABLE client_ops (
    op_id TEXT PRIMARY KEY,
    user_id INT REFERENCES users(id),
    name TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  INSERT INTO accounts (number, label) VALUES
    ('213', 'Logiciels'),
    ('231', 'Bâtiments'),
    ('2441', 'Matériel de bureau'),
    ('2444', 'Matériel informatique'),
    ('2446', 'Mobilier de bureau'),
    ('2813', 'Amortissements des logiciels'),
    ('2831', 'Amortissements des bâtiments'),
    ('2844', 'Amortissements du matériel et mobilier'),
    ('2845', 'Amortissements du matériel de transport'),
    ('423', 'Personnel, oppositions et saisies'),
    ('663', 'Indemnités forfaitaires versées au personnel'),
    ('681', 'Dotations aux amortissements d''exploitation'),
    ('812', 'Valeurs comptables des cessions d''immobilisations'),
    ('822', 'Produits des cessions d''immobilisations')
  ON CONFLICT (number) DO NOTHING
  `,
  // v5 : taxes de facturation (taxes additionnelles et retenues à la source)
  `
  CREATE TABLE taxes (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('addition','withholding')),
    base TEXT NOT NULL CHECK (base IN ('ht','tva','ttc','fixed')),
    rate DOUBLE PRECISION NOT NULL DEFAULT 0,
    amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    account_sale TEXT NOT NULL DEFAULT '',
    account_purchase TEXT NOT NULL DEFAULT '',
    applies_to TEXT NOT NULL DEFAULT 'both' CHECK (applies_to IN ('sale','purchase','both')),
    auto BOOLEAN NOT NULL DEFAULT false,
    active BOOLEAN NOT NULL DEFAULT true,
    position INT NOT NULL DEFAULT 0
  );
  ALTER TABLE documents ADD COLUMN taxes JSONB NOT NULL DEFAULT '[]';
  ALTER TABLE documents ADD COLUMN total_taxes DOUBLE PRECISION NOT NULL DEFAULT 0;
  ALTER TABLE documents ADD COLUMN total_withheld DOUBLE PRECISION NOT NULL DEFAULT 0;
  ALTER TABLE payments ADD COLUMN tax_account TEXT;
  INSERT INTO accounts (number, label) VALUES
    ('447', 'État, impôts retenus à la source'),
    ('449', 'État, créances et dettes diverses'),
    ('645', 'Impôts et taxes indirects'),
    ('646', 'Droits d''enregistrement')
  ON CONFLICT (number) DO NOTHING
  `,
  // v6 : cotisations sociales supplémentaires, photo de profil des utilisateurs
  `
  ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
  INSERT INTO accounts (number, label) VALUES
    ('438', 'Organismes sociaux, autres cotisations'),
    ('4413', 'État, impôt sur les bénéfices (acomptes BIC/IS)'),
    ('891', 'Impôts sur les bénéfices de l''exercice')
  ON CONFLICT (number) DO NOTHING
  `,
  // v7 : gestion de projet — dépenses, tâches et jalons, budget par poste, coût horaire interne
  `
  ALTER TABLE projects ADD COLUMN cost_rate DOUBLE PRECISION NOT NULL DEFAULT 0;
  ALTER TABLE projects ADD COLUMN budget_lines JSONB NOT NULL DEFAULT '{}';
  CREATE TABLE project_expenses (
    id SERIAL PRIMARY KEY,
    project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    supplier TEXT NOT NULL DEFAULT '',
    amount_ht DOUBLE PRECISION NOT NULL CHECK (amount_ht > 0),
    tva_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
    amount_ttc DOUBLE PRECISION NOT NULL,
    paid BOOLEAN NOT NULL DEFAULT TRUE,
    payment_method TEXT NOT NULL DEFAULT '',
    billable BOOLEAN NOT NULL DEFAULT FALSE,
    markup DOUBLE PRECISION NOT NULL DEFAULT 0,
    invoice_id INT REFERENCES documents(id) ON DELETE SET NULL,
    receipt TEXT NOT NULL DEFAULT '',
    user_id INT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX project_expenses_project_idx ON project_expenses(project_id, date);
  CREATE TABLE project_tasks (
    id SERIAL PRIMARY KEY,
    project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'a_faire' CHECK (status IN ('a_faire','en_cours','bloque','termine')),
    milestone BOOLEAN NOT NULL DEFAULT FALSE,
    assignee_id INT REFERENCES users(id),
    start_date TEXT,
    due_date TEXT,
    estimated_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
    progress INT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX project_tasks_project_idx ON project_tasks(project_id, status);
  ALTER TABLE time_entries ADD COLUMN task_id INT REFERENCES project_tasks(id) ON DELETE SET NULL;
  INSERT INTO accounts (number, label) VALUES
    ('604', 'Achats stockés de matières et fournitures'),
    ('605', 'Autres achats'),
    ('618', 'Autres frais de transport'),
    ('621', 'Sous-traitance générale'),
    ('622', 'Locations et charges locatives'),
    ('637', 'Rémunérations de personnel extérieur à l''entreprise'),
    ('638', 'Autres charges externes')
  ON CONFLICT (number) DO NOTHING
  `,
  // v8 : factures récurrentes (contrats de maintenance, abonnements, loyers)
  `
  CREATE TABLE recurring_invoices (
    id SERIAL PRIMARY KEY,
    party_id INT NOT NULL REFERENCES parties(id),
    label TEXT NOT NULL,
    lines JSONB NOT NULL,
    taxes JSONB NOT NULL DEFAULT '[]',
    frequency TEXT NOT NULL CHECK (frequency IN ('mensuel','trimestriel','semestriel','annuel')),
    next_date TEXT NOT NULL,
    end_date TEXT,
    auto_validate BOOLEAN NOT NULL DEFAULT FALSE,
    project_id INT REFERENCES projects(id) ON DELETE SET NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    generated INT NOT NULL DEFAULT 0,
    last_document_id INT REFERENCES documents(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX recurring_due_idx ON recurring_invoices(active, next_date)
  `,
  // v9 : profil « Gestionnaire de licences » et registre des licences émises (poste de l'éditeur)
  `
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','commercial','magasinier','comptable','caissier','rh','licences'));
  CREATE TABLE licences_issued (
    id SERIAL PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    company TEXT NOT NULL,
    tax_id TEXT,
    tier TEXT NOT NULL,
    modules JSONB NOT NULL DEFAULT '[]',
    users INT NOT NULL DEFAULT 0,
    issued TEXT NOT NULL,
    expires TEXT,
    white_label BOOLEAN NOT NULL DEFAULT FALSE,
    licence_key TEXT NOT NULL,
    contact TEXT,
    notes TEXT,
    renews_id INT REFERENCES licences_issued(id) ON DELETE SET NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_reason TEXT,
    issued_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX licences_issued_company_idx ON licences_issued(company)
  `
]
