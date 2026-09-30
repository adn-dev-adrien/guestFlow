/**
 * The control plane's own SQLite database (specs/control-plane-plans-and-access.md §5). Idempotent:
 * every table is created if missing, and the catalogue is seeded once with the plans the owner
 * decided on 2026-09-29 (rule 3).
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
`;

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

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  seedCatalogue(db);
  return db;
}

module.exports = { openDatabase, SEED_PLANS, SEED_ADDONS };
