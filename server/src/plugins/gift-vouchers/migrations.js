/**
 * The tables of the plugin (specs/gift-vouchers.md §5), in one idempotent migration. No core column and no
 * foreign key into the core: a voucher outlives a deleted reservation and a deactivated plugin keeps its rows (rule 4).
 * `publicTokenEncrypted` keeps the voucher link (rule 21) re-sendable, like `guest_stay_links.tokenEncrypted`.
 * The ledger is append-only (rule 31): the triggers refuse an update and a delete.
 */

const rules = require('./voucherRules');

const { KINDS } = rules;

const list = (values) => values.map((v) => `'${v}'`).join(', ');

const TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS gift_voucher_orders (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    publicTokenHash      TEXT UNIQUE,
    publicTokenEncrypted TEXT,
    amountCents          INTEGER NOT NULL CHECK (amountCents > 0),
    recipientName        TEXT NOT NULL DEFAULT '',
    senderName           TEXT NOT NULL DEFAULT '',
    message              TEXT NOT NULL DEFAULT '',
    email                TEXT NOT NULL DEFAULT '',
    language             TEXT NOT NULL DEFAULT 'fr' CHECK (language IN ('fr', 'en')),
    termsVersionId       INTEGER,
    termsAcceptedAt      TEXT,
    visitorHash          TEXT,
    source               TEXT NOT NULL CHECK (source IN ('site', 'manual')),
    paymentMethod        TEXT,
    linkId               INTEGER,
    state                TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'issued')),
    createdAt            TEXT NOT NULL,
    createdBy            TEXT NOT NULL DEFAULT 'public'
  );
  CREATE INDEX IF NOT EXISTS idx_gift_voucher_orders_state ON gift_voucher_orders(state, createdAt);

  CREATE TABLE IF NOT EXISTS gift_vouchers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId       INTEGER NOT NULL UNIQUE,
    number        TEXT NOT NULL UNIQUE,
    codeHash      TEXT NOT NULL UNIQUE,
    codeEncrypted TEXT NOT NULL,
    amountCents   INTEGER NOT NULL CHECK (amountCents > 0),
    issuedAt      TEXT NOT NULL,
    expiresOn     TEXT NOT NULL,
    cancelledAt   TEXT,
    mailSentAt    TEXT,
    mailError     TEXT
  );

  CREATE TABLE IF NOT EXISTS gift_voucher_movements (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    voucherId      INTEGER NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN (${list(KINDS)})),
    amountCents    INTEGER NOT NULL DEFAULT 0,
    reservationId  INTEGER,
    devisId        INTEGER,
    actor          TEXT NOT NULL,
    note           TEXT,
    idempotencyKey TEXT NOT NULL UNIQUE,
    createdAt      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gift_voucher_movements_voucher ON gift_voucher_movements(voucherId, id);
  CREATE TRIGGER IF NOT EXISTS gift_voucher_movements_no_update BEFORE UPDATE ON gift_voucher_movements
    BEGIN SELECT RAISE(ABORT, 'gift_voucher_movements is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS gift_voucher_movements_no_delete BEFORE DELETE ON gift_voucher_movements
    BEGIN SELECT RAISE(ABORT, 'gift_voucher_movements is append-only'); END;

  CREATE TABLE IF NOT EXISTS gift_voucher_checks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    visitorHash TEXT NOT NULL,
    outcome     TEXT NOT NULL CHECK (outcome IN ('usable', 'expired', 'exhausted', 'unknown', 'mistyped')),
    createdAt   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gift_voucher_checks_visitor ON gift_voucher_checks(visitorHash, createdAt);
  CREATE INDEX IF NOT EXISTS idx_gift_voucher_checks_at ON gift_voucher_checks(createdAt);
`;

const TABLES = ['gift_voucher_orders', 'gift_vouchers', 'gift_voucher_movements', 'gift_voucher_checks'];

// Rule 43 — the VAT rate frozen on a voucher when it is sold; the vouchers sold before it existed were sold at 10 %.
const VAT_SQL = 'ALTER TABLE gift_vouchers ADD COLUMN vatRatePercent REAL NOT NULL DEFAULT 10';

// specs/gift-voucher-campaigns.md §5 — the campaigns, and the campaign, frozen contents and VAT lines every order and voucher carries. A voucher or an order
// sold before it is a `lodging` one: `contents` defaults to that kind, `campaignId` is filled by the data move below.
const CAMPAIGNS_SQL = `
  CREATE TABLE IF NOT EXISTS gift_voucher_campaigns (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    title               TEXT NOT NULL,
    kind                TEXT NOT NULL CHECK (kind IN ('lodging', 'resource')),
    state               TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'on_sale', 'closed')),
    oneShot             INTEGER NOT NULL DEFAULT 0,
    slug                TEXT UNIQUE,
    slugLockedAt        TEXT,
    validityMonths      INTEGER NOT NULL,
    composition         TEXT,
    addOns              TEXT NOT NULL DEFAULT '[]',
    extraTimeMaxMinutes INTEGER NOT NULL DEFAULT 0,
    minAmountCents      INTEGER,
    maxAmountCents      INTEGER,
    ideas               TEXT NOT NULL DEFAULT '[]',
    vatRatePercent      REAL,
    voucherVisualId     INTEGER,
    merchantVisualId    INTEGER,
    createdAt           TEXT NOT NULL,
    updatedAt           TEXT NOT NULL
  );
`;

const hasColumn = (db, table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

const addColumn = (db, table, column, definition) => {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};

/** The plugin's settings the campaigns took over, as stored (text), or `{}` when the host has no settings table. */
function storedSettings(db) {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plugin_settings'").get();
  if (!table) return {};
  return Object.fromEntries(db.prepare("SELECT key, value FROM plugin_settings WHERE plugin_id = 'gift-vouchers'").all().map((r) => [r.key, r.value]));
}

const positiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/**
 * Rule 3 — the lodging settings (bounds, validity, VAT rate, ideas) become the one `lodging` campaign `sejour`. It is on sale when the plugin was set up
 * (the page of the voucher saved), else a draft. Every order and voucher points to it. Idempotent: it runs once, and does nothing when a lodging campaign exists.
 */
function moveSettingsToLodgingCampaign(db) {
  if (db.prepare("SELECT 1 FROM gift_voucher_campaigns WHERE kind = 'lodging' LIMIT 1").get()) return;
  const stored = storedSettings(db);
  const min = positiveInt(stored.minAmountCents, rules.DEFAULT_MIN_CENTS);
  const max = positiveInt(stored.maxAmountCents, rules.DEFAULT_MAX_CENTS);
  const vat = rules.checkVatRate(stored.vatRatePercent);
  const at = new Date().toISOString();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO gift_voucher_campaigns (name, title, kind, state, slug, validityMonths, minAmountCents, maxAmountCents, ideas, vatRatePercent, createdAt, updatedAt)
    VALUES ('Bon cadeau séjour', 'Bon cadeau', 'lodging', ?, 'sejour', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(stored.pageUrl || '').trim() ? 'on_sale' : 'draft',
    Math.min(positiveInt(stored.validityMonths, rules.DEFAULT_VALIDITY_MONTHS), rules.MAX_VALIDITY_MONTHS),
    ...(min <= max ? [min, max] : [rules.DEFAULT_MIN_CENTS, rules.DEFAULT_MAX_CENTS]),
    stored.ideas || '[]',
    vat.ok ? vat.percent : rules.DEFAULT_VAT_PERCENT,
    at,
    at,
  );
  db.prepare('UPDATE gift_voucher_orders SET campaignId = ? WHERE campaignId IS NULL').run(lastInsertRowid);
  db.prepare('UPDATE gift_vouchers SET campaignId = ? WHERE campaignId IS NULL').run(lastInsertRowid);
}

function campaignsMigration(db) {
  db.exec(CAMPAIGNS_SQL);
  ['gift_voucher_orders', 'gift_vouchers'].forEach((table) => {
    addColumn(db, table, 'campaignId', 'INTEGER');
    addColumn(db, table, 'contents', `TEXT NOT NULL DEFAULT '{"kind":"lodging"}'`);
    addColumn(db, table, 'vatLines', 'TEXT');
  });
  moveSettingsToLodgingCampaign(db);
}

const MIGRATIONS = Object.freeze([
  { name: 'gift_vouchers_tables_v1', up: (db) => db.exec(TABLES_SQL) },
  { name: 'gift_vouchers_vat_v1', up: (db) => db.exec(VAT_SQL) },
  { name: 'gift_voucher_campaigns_v1', up: campaignsMigration },
]);

module.exports = { MIGRATIONS, TABLES: Object.freeze([...TABLES, 'gift_voucher_campaigns']) };
