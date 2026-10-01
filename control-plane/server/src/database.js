/**
 * The control plane's own SQLite database (specs/control-plane-plans-and-access.md §5). Idempotent:
 * every table is created if missing, and the catalogue is seeded once with the plans the owner
 * decided on 2026-09-29 (rule 3). C2b adds the Qonto settings, the email templates and the customer
 * emails, and the billing columns of `customers` and `invoices`. C3 adds the directory and the old
 * slugs kept for 12 months.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS operators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  passwordHash TEXT NOT NULL,
  mfaMethod TEXT NOT NULL DEFAULT 'email',
  totpSecret TEXT,
  pendingMethod TEXT,
  pendingTotpSecret TEXT,
  backupCodes TEXT NOT NULL DEFAULT '[]',
  failedCount INTEGER NOT NULL DEFAULT 0,
  lockedUntil TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mfa_codes (
  operatorId INTEGER PRIMARY KEY REFERENCES operators(id) ON DELETE CASCADE,
  codeHash TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rank INTEGER NOT NULL UNIQUE,
  priceMonthlyCents INTEGER NOT NULL,
  priceYearlyCents INTEGER NOT NULL,
  maxUnits INTEGER,
  maxUsers INTEGER
);
CREATE TABLE IF NOT EXISTS plan_plugins (
  pluginId TEXT PRIMARY KEY,
  planCode TEXT NOT NULL REFERENCES plans(code)
);
CREATE TABLE IF NOT EXISTS addons (
  pluginId TEXT PRIMARY KEY,
  priceMonthlyCents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS catalogue_versions (
  version INTEGER PRIMARY KEY,
  snapshotJson TEXT NOT NULL,
  changedBy TEXT NOT NULL,
  changedAt TEXT NOT NULL,
  reason TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  companyName TEXT NOT NULL,
  contactName TEXT NOT NULL DEFAULT '',
  contactEmail TEXT NOT NULL,
  state TEXT NOT NULL,
  stateSince TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  archivedAt TEXT,
  eraseAt TEXT,
  erasedAt TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_customers_live_slug ON customers(slug) WHERE erasedAt IS NULL;
CREATE TABLE IF NOT EXISTS subscriptions (
  customerId INTEGER PRIMARY KEY REFERENCES customers(id),
  planCode TEXT NOT NULL REFERENCES plans(code),
  billing TEXT NOT NULL CHECK (billing IN ('monthly', 'yearly')),
  periodMonths INTEGER NOT NULL,
  startsAt TEXT NOT NULL,
  endsAt TEXT NOT NULL,
  trialEndsAt TEXT,
  forceActiveUntil TEXT,
  catalogueVersion INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_addons (
  customerId INTEGER NOT NULL REFERENCES customers(id),
  pluginId TEXT NOT NULL,
  since TEXT NOT NULL,
  PRIMARY KEY (customerId, pluginId)
);
CREATE TABLE IF NOT EXISTS grandfathered_plugins (
  customerId INTEGER NOT NULL REFERENCES customers(id),
  pluginId TEXT NOT NULL,
  since TEXT NOT NULL,
  PRIMARY KEY (customerId, pluginId)
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customerId INTEGER NOT NULL REFERENCES customers(id),
  periodStart TEXT NOT NULL,
  periodEnd TEXT NOT NULL,
  amountCents INTEGER NOT NULL,
  provider TEXT NOT NULL,
  providerRef TEXT,
  payUrl TEXT,
  status TEXT NOT NULL,
  paidAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customerId INTEGER NOT NULL REFERENCES customers(id),
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  operator TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS provisioning_steps (
  customerId INTEGER NOT NULL REFERENCES customers(id),
  step TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'todo', 'skipped')),
  detail TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  PRIMARY KEY (customerId, step)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  day TEXT NOT NULL,
  operator TEXT NOT NULL,
  customerId INTEGER,
  kind TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_customer ON audit(customerId, id);
CREATE INDEX IF NOT EXISTS idx_audit_day ON audit(day, kind);
CREATE TABLE IF NOT EXISTS exports (
  token TEXT PRIMARY KEY,
  customerId INTEGER NOT NULL REFERENCES customers(id),
  path TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS qonto_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  qontoEnvironment TEXT NOT NULL DEFAULT '',
  qontoClientId TEXT NOT NULL DEFAULT '',
  qontoClientSecretEncrypted TEXT NOT NULL DEFAULT '',
  qontoStagingTokenEncrypted TEXT NOT NULL DEFAULT '',
  qontoWebhookSecretEncrypted TEXT NOT NULL DEFAULT '',
  publicSiteOrigin TEXT NOT NULL DEFAULT '',
  qontoAccessTokenEncrypted TEXT NOT NULL DEFAULT '',
  qontoRefreshTokenEncrypted TEXT NOT NULL DEFAULT '',
  qontoTokenExpiresAt TEXT NOT NULL DEFAULT '',
  qontoConnectedAt TEXT NOT NULL DEFAULT '',
  qontoConnectionId TEXT NOT NULL DEFAULT '',
  qontoConnectionStatus TEXT NOT NULL DEFAULT 'not_connected',
  qontoLastCheckAt TEXT NOT NULL DEFAULT '',
  qontoLastSuccessAt TEXT NOT NULL DEFAULT '',
  qontoLastErrorAt TEXT NOT NULL DEFAULT '',
  qontoLastErrorCode TEXT NOT NULL DEFAULT '',
  qontoLastErrorMessage TEXT NOT NULL DEFAULT '',
  qontoLastErrorOrigin TEXT NOT NULL DEFAULT '',
  qontoWebhookSubscriptionId TEXT NOT NULL DEFAULT '',
  qontoWebhookCallbackUrl TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS email_templates (
  key TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sendMode TEXT NOT NULL DEFAULT 'manual' CHECK (sendMode IN ('manual', 'auto')),
  updatedAt TEXT,
  updatedBy TEXT
);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customerId INTEGER NOT NULL REFERENCES customers(id),
  invoiceId INTEGER NOT NULL REFERENCES invoices(id),
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'ignored', 'dropped', 'failed')),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  preparedAt TEXT NOT NULL,
  handledAt TEXT,
  operator TEXT,
  error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_reminders_scheduled ON reminders(invoiceId, kind) WHERE kind <> 'reminder_manual';
CREATE INDEX IF NOT EXISTS idx_reminders_customer ON reminders(customerId, id);
CREATE TABLE IF NOT EXISTS directory (
  emailHmac TEXT NOT NULL,
  customerId INTEGER NOT NULL REFERENCES customers(id),
  seenAt TEXT NOT NULL,
  PRIMARY KEY (emailHmac, customerId)
);
CREATE INDEX IF NOT EXISTS idx_directory_customer ON directory(customerId);
CREATE TABLE IF NOT EXISTS slug_aliases (
  slug TEXT PRIMARY KEY,
  customerId INTEGER NOT NULL REFERENCES customers(id),
  until TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_failures (
  providerPaymentId TEXT PRIMARY KEY,
  invoiceId INTEGER NOT NULL REFERENCES invoices(id),
  status TEXT NOT NULL,
  at TEXT NOT NULL
);
`;

// Columns added after a table first shipped (C2b): added when missing, so a console database created
// by C2a carries on (specs/control-plane-plans-and-access.md §5).
const ADDED_COLUMNS = {
  customers: {
    billingStreet: "TEXT NOT NULL DEFAULT ''",
    billingPostcode: "TEXT NOT NULL DEFAULT ''",
    billingCity: "TEXT NOT NULL DEFAULT ''",
    billingCountry: "TEXT NOT NULL DEFAULT 'FR'",
    vatNumber: "TEXT NOT NULL DEFAULT ''",
    qontoClientId: 'TEXT',
  },
  invoices: {
    months: 'INTEGER',
    totalCents: 'INTEGER',
    number: 'TEXT',
    invoiceUrl: 'TEXT',
    payLinkId: 'TEXT',
    paidBy: 'TEXT',
    lastError: 'TEXT',
  },
};

function addMissingColumns(db) {
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, type] of Object.entries(columns)) {
      if (!present.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
}

// Rule 3, decided 2026-09-29: the plugins each plan adds (higher plans inherit), prices in cents
// excl. VAT (monthly billing / per month when billed yearly), quotas (null = unlimited).
const SEED_PLANS = [
  { code: 'essentiel', name: 'Essentiel', rank: 1, priceMonthlyCents: 2900, priceYearlyCents: 2400, maxUnits: 2, maxUsers: 2,
    plugins: ['school-holidays', 'weather-alerts', 'google-calendar', 'sas'] },
  { code: 'pro', name: 'Pro', rank: 2, priceMonthlyCents: 5900, priceYearlyCents: 4900, maxUnits: 6, maxUsers: 5,
    plugins: ['website-booking', 'online-payment', 'linen', 'accounting-export'] },
  { code: 'premium', name: 'Premium', rank: 3, priceMonthlyCents: 9900, priceYearlyCents: 8300, maxUnits: 15, maxUsers: null,
    plugins: ['tariff-recipes', 'hourly-resources', 'neat', 'gate-access'] },
];
const SEED_ADDONS = [
  { pluginId: 'gate-access', priceMonthlyCents: 1200 },
  { pluginId: 'neat', priceMonthlyCents: 900 },
  { pluginId: 'hourly-resources', priceMonthlyCents: 900 },
];

function seedCatalogue(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM plans').get().n > 0) return;
  const insertPlan = db.prepare(`INSERT INTO plans (code, name, rank, priceMonthlyCents, priceYearlyCents, maxUnits, maxUsers)
    VALUES (@code, @name, @rank, @priceMonthlyCents, @priceYearlyCents, @maxUnits, @maxUsers)`);
  const insertPlugin = db.prepare('INSERT INTO plan_plugins (pluginId, planCode) VALUES (?, ?)');
  const insertAddon = db.prepare('INSERT INTO addons (pluginId, priceMonthlyCents) VALUES (?, ?)');
  db.transaction(() => {
    const lowest = {};
    for (const plan of SEED_PLANS) {
      insertPlan.run(plan);
      for (const id of plan.plugins) { insertPlugin.run(id, plan.code); lowest[id] = plan.code; }
    }
    for (const a of SEED_ADDONS) insertAddon.run(a.pluginId, a.priceMonthlyCents);
    const snapshot = {
      plans: SEED_PLANS.map(({ plugins, ...p }) => p),
      lowest,
      addons: SEED_ADDONS,
    };
    db.prepare('INSERT INTO catalogue_versions (version, snapshotJson, changedBy, changedAt, reason) VALUES (1, ?, ?, ?, ?)')
      .run(JSON.stringify(snapshot), 'seed', new Date().toISOString(), 'Catalogue initial (décidé le 29/09/2026)');
  })();
}

// Rule 33: the five templates, the four scheduled ones in « Manuel ».
function seedTemplates(db) {
  const { DEFAULT_TEMPLATES } = require('./utils/templates');
  const insert = db.prepare("INSERT OR IGNORE INTO email_templates (key, subject, body, sendMode) VALUES (?, ?, ?, 'manual')");
  for (const t of DEFAULT_TEMPLATES) insert.run(t.key, t.subject, t.body);
}

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  addMissingColumns(db);
  seedCatalogue(db);
  db.prepare('INSERT OR IGNORE INTO qonto_settings (id) VALUES (1)').run();
  seedTemplates(db);
  return db;
}

module.exports = { openDatabase, SEED_PLANS, SEED_ADDONS };
