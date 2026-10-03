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
  `
]
