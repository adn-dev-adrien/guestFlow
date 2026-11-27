/**
 * The tables of the plugin (specs/gift-vouchers/gift-vouchers.md §5), in one idempotent migration. No core column and no
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

// specs/gift-vouchers/gift-voucher-campaigns.md §5 — the campaigns, and the campaign, frozen contents and VAT lines every order and voucher carries. A voucher or an order
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

// specs/gift-vouchers/gift-voucher-campaigns.md §5 — the visual library with its versions, the refund lines of cancelled vouchers, and what a voucher freezes of
// them (the version of its front, rule 48). The first spec stored no voucher image, so there is nothing to carry into the library.
const VISUALS_SQL = `
  CREATE TABLE IF NOT EXISTS gift_voucher_visuals (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    use       TEXT NOT NULL CHECK (use IN ('voucher', 'merchant', 'both')),
    deletedAt TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS gift_voucher_visual_versions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    visualId  INTEGER NOT NULL,
    path      TEXT NOT NULL,
    width     INTEGER NOT NULL,
    height    INTEGER NOT NULL,
    createdAt TEXT NOT NULL,
    purgedAt  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_gift_voucher_visual_versions_visual ON gift_voucher_visual_versions(visualId, id);
  CREATE TABLE IF NOT EXISTS gift_voucher_refunds (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    voucherId   INTEGER NOT NULL,
    amountCents INTEGER NOT NULL CHECK (amountCents > 0),
    openedAt    TEXT NOT NULL,
    settledAt   TEXT,
    settledBy   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_gift_voucher_refunds_voucher ON gift_voucher_refunds(voucherId);
`;

const hasTable = (db, table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));

/**
 * Rule 37 — the acceptance a site order recorded in its own columns becomes a row of the core's `terms_acceptances` (activity `lodging`, subject the order,
 * channel `site`). The columns stay, unread. Idempotent: an order already carried over is skipped; a host with no such table has nothing to carry.
 */
function moveOrderTermsToAcceptances(db) {
  if (!hasTable(db, 'terms_acceptances') || !hasColumn(db, 'terms_acceptances', 'subjectType')) return;
  db.prepare(`
    INSERT INTO terms_acceptances (reservationId, termsVersionId, acceptedAt, activity, subjectType, subjectRef, channel)
    SELECT NULL, o.termsVersionId, o.termsAcceptedAt, 'lodging', 'voucherOrder', CAST(o.id AS TEXT), 'site'
    FROM gift_voucher_orders o
    WHERE o.termsVersionId IS NOT NULL AND o.termsAcceptedAt IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM terms_acceptances a WHERE a.subjectType = 'voucherOrder' AND a.subjectRef = CAST(o.id AS TEXT))
  `).run();
}

function visualsMigration(db) {
  db.exec(VISUALS_SQL);
  addColumn(db, 'gift_vouchers', 'visualVersions', 'TEXT');
  addColumn(db, 'gift_vouchers', 'cancelReason', 'TEXT');
  addColumn(db, 'gift_vouchers', 'cancelForced', 'INTEGER NOT NULL DEFAULT 0');
  moveOrderTermsToAcceptances(db);
}

// specs/gift-vouchers/gift-voucher-campaigns.md rules 15, 29 — a recipient's use of a composed voucher on « Mon bain » (held 15 minutes while a remainder is paid, then booked or lapsed),
// and what a voucher paid for that was not taken. The ledger itself is untouched: a use writes its own `hold` / `release` / `redeem` movements by key.
const USES_SQL = `
  CREATE TABLE IF NOT EXISTS gift_voucher_uses (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    voucherId      INTEGER NOT NULL,
    state          TEXT NOT NULL CHECK (state IN ('held', 'booked', 'lapsed', 'refund_owed')),
    resourceId     INTEGER NOT NULL,
    date           TEXT NOT NULL,
    startTime      TEXT NOT NULL,
    endTime        TEXT NOT NULL,
    extraMinutes   INTEGER NOT NULL DEFAULT 0,
    addOns         TEXT NOT NULL DEFAULT '[]',
    name           TEXT NOT NULL DEFAULT '',
    email          TEXT NOT NULL,
    phone          TEXT NOT NULL DEFAULT '',
    termsVersionId INTEGER,
    userAgent      TEXT,
    ip             TEXT,
    holdRef        TEXT NOT NULL,
    dueCents       INTEGER NOT NULL DEFAULT 0,
    linkId         INTEGER,
    heldUntil      TEXT NOT NULL,
    bookingId      INTEGER,
    saleId         INTEGER,
    note           TEXT,
    createdAt      TEXT NOT NULL,
    settledAt      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_gift_voucher_uses_voucher ON gift_voucher_uses(voucherId, state);
  CREATE INDEX IF NOT EXISTS idx_gift_voucher_uses_held ON gift_voucher_uses(state, heldUntil);
  CREATE TABLE IF NOT EXISTS gift_voucher_unused (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    voucherId  INTEGER NOT NULL,
    label      TEXT NOT NULL,
    valueCents INTEGER NOT NULL,
    at         TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gift_voucher_unused_voucher ON gift_voucher_unused(voucherId);
`;

// specs/site/site-outside-resource-booking.md rule 26 — the people declared with a session booked with a voucher. NULL for every existing use.
const usesPeople = (db) => {
  if (!db.prepare('PRAGMA table_info(gift_voucher_uses)').all().some((c) => c.name === 'people')) db.exec('ALTER TABLE gift_voucher_uses ADD COLUMN people INTEGER');
};

// specs/site/site-outside-resource-booking.md rule 16 — the return page of a voucher's remainder reads its use by an unguessable ref and shows the recap chosen. NULL for every existing use.
const usesRef = (db) => {
  const cols = db.prepare('PRAGMA table_info(gift_voucher_uses)').all().map((c) => c.name);
  if (!cols.includes('ref')) db.exec('ALTER TABLE gift_voucher_uses ADD COLUMN ref TEXT');
  if (!cols.includes('recap')) db.exec('ALTER TABLE gift_voucher_uses ADD COLUMN recap TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_voucher_uses_ref ON gift_voucher_uses(ref)');
};

// specs/site/site-outside-resource-booking.md rules 32-33 — the recipient in two fields. `recipientName` stays, as the first name, for every reader that prints it; an order made before keeps its name as the first name and has no last name.
const recipientNames = (db) => {
  addColumn(db, 'gift_voucher_orders', 'recipientFirstName', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'gift_voucher_orders', 'recipientLastName', "TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE gift_voucher_orders SET recipientFirstName = recipientName WHERE recipientFirstName = '' AND recipientName != ''");
};

// week-weekend-and-print spec rules 10, 13, 21 — the periods a campaign sells (both at first, so what is on sale keeps selling), the corner of the merchant card's price, and the
// validity moved to the short list: 3, 6, 12, 18 or 24 months, the nearest one (no voucher was sold with another value).
const weekendPeriods = (db) => {
  addColumn(db, 'gift_voucher_campaigns', 'periods', `TEXT NOT NULL DEFAULT '["week","weekend"]'`);
  addColumn(db, 'gift_voucher_campaigns', 'frontPricePosition', "TEXT NOT NULL DEFAULT 'bottom-right'");
  db.prepare('SELECT id, name, validityMonths FROM gift_voucher_campaigns').all().forEach((row) => {
    if (rules.VALIDITY_CHOICES.includes(row.validityMonths)) return;
    // The choices run upwards and `<=` lets the later one win a tie: 9 months becomes 12, never 6 (a validity is never shortened by the move).
    const nearest = rules.VALIDITY_CHOICES.reduce((best, n) => (Math.abs(n - row.validityMonths) <= Math.abs(best - row.validityMonths) ? n : best), rules.VALIDITY_CHOICES[0]);
    db.prepare('UPDATE gift_voucher_campaigns SET validityMonths = ? WHERE id = ?').run(nearest, row.id);
    console.log(`[gift-vouchers] campaign "${row.name}" (#${row.id}): validity ${row.validityMonths} months is now ${nearest} months (3, 6, 12, 18 or 24 are the only choices).`);
  });
};

const MIGRATIONS = Object.freeze([
  { name: 'gift_vouchers_tables_v1', up: (db) => db.exec(TABLES_SQL) },
  { name: 'gift_vouchers_vat_v1', up: (db) => db.exec(VAT_SQL) },
  { name: 'gift_voucher_campaigns_v1', up: campaignsMigration },
  { name: 'gift_voucher_visuals_v1', up: visualsMigration },
  { name: 'gift_voucher_uses_v1', up: (db) => db.exec(USES_SQL) },
  { name: 'gift_voucher_uses_people_v2', up: usesPeople },
  { name: 'gift_voucher_uses_ref_v3', up: usesRef },
  { name: 'gift_voucher_recipient_names_v4', up: recipientNames },
  { name: 'gift_voucher_week_weekend_v5', up: weekendPeriods },
]);

module.exports = { MIGRATIONS, TABLES: Object.freeze([...TABLES, 'gift_voucher_campaigns', 'gift_voucher_visuals', 'gift_voucher_visual_versions', 'gift_voucher_refunds', 'gift_voucher_uses', 'gift_voucher_unused']) };
