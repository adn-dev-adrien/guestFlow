/**
 * Every table of the guest app (specs/guest-app.md §5), in one idempotent migration. No core column and
 * no foreign key: an order or a session must outlive a deleted reservation, and a deactivated plugin
 * keeps its rows (rule 22).
 */

const TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS guest_app_lodgings (
    propertyId            INTEGER PRIMARY KEY,
    enabled               INTEGER NOT NULL DEFAULT 0,
    lodgingCode           TEXT UNIQUE,
    displayName           TEXT,
    heroMediaId           INTEGER,
    modulesJson           TEXT,
    wifiAvailable         INTEGER NOT NULL DEFAULT 0,
    wifiNetwork           TEXT,
    wifiPasswordEncrypted TEXT,
    wifiNote              TEXT,
    contactsJson          TEXT,
    bookletSeededAt       TEXT
  );
  CREATE TABLE IF NOT EXISTS guest_app_items (
    kind               TEXT NOT NULL CHECK (kind IN ('option', 'resource')),
    itemId             INTEGER NOT NULL,
    sold               INTEGER NOT NULL DEFAULT 0,
    mediaId            INTEGER,
    shortDescriptionFr TEXT,
    shortDescriptionEn TEXT,
    maxQuantity        INTEGER NOT NULL DEFAULT 10,
    needsStaff         INTEGER NOT NULL DEFAULT 0,
    leadMinutes        INTEGER NOT NULL DEFAULT 30,
    sortOrder          INTEGER,
    PRIMARY KEY (kind, itemId)
  );
  CREATE TABLE IF NOT EXISTS guest_app_service_hours (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    fromTime   TEXT NOT NULL,
    toTime     TEXT NOT NULL,
    propertyId INTEGER
  );
  CREATE TABLE IF NOT EXISTS guest_app_service_exceptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,
    propertyId INTEGER,
    closed     INTEGER NOT NULL DEFAULT 0,
    rangesJson TEXT
  );
  CREATE TABLE IF NOT EXISTS guest_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tokenHash       TEXT NOT NULL UNIQUE,
    propertyId      INTEGER NOT NULL,
    reservationId   INTEGER,
    mode            TEXT NOT NULL CHECK (mode IN ('stay', 'preArrival', 'visitor')),
    origin          TEXT NOT NULL CHECK (origin IN ('link', 'poster', 'lookup')),
    stayLinkId      INTEGER,
    createdAt       TEXT NOT NULL,
    lastSeenAt      TEXT NOT NULL,
    expiresAt       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_guest_sessions_expiry ON guest_sessions(expiresAt);
  CREATE TABLE IF NOT EXISTS guest_stay_links (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId  INTEGER NOT NULL,
    tokenEncrypted TEXT NOT NULL,
    tokenHash      TEXT NOT NULL UNIQUE,
    createdAt      TEXT NOT NULL,
    revokedAt      TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_stay_links_live ON guest_stay_links(reservationId) WHERE revokedAt IS NULL;
  CREATE TABLE IF NOT EXISTS guest_booklet_pages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    slug         TEXT NOT NULL,
    icon         TEXT,
    coverMediaId INTEGER,
    titleFr      TEXT NOT NULL DEFAULT '',
    titleEn      TEXT,
    placeholder  INTEGER NOT NULL DEFAULT 0,
    updatedAt    TEXT
  );
  CREATE TABLE IF NOT EXISTS guest_booklet_placements (
    pageId     INTEGER NOT NULL,
    propertyId INTEGER NOT NULL,
    sortOrder  INTEGER NOT NULL DEFAULT 0,
    published  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (pageId, propertyId)
  );
  CREATE TABLE IF NOT EXISTS guest_booklet_blocks (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    pageId                 INTEGER NOT NULL,
    sortOrder              INTEGER NOT NULL DEFAULT 0,
    onlyForPropertyIdsJson TEXT,
    type                   TEXT NOT NULL,
    dataJson               TEXT NOT NULL DEFAULT '{}',
    updatedAt              TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_guest_booklet_blocks_page ON guest_booklet_blocks(pageId, sortOrder);
  CREATE INDEX IF NOT EXISTS idx_guest_booklet_placements_property ON guest_booklet_placements(propertyId, sortOrder);
  CREATE TABLE IF NOT EXISTS guest_booklet_versions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId   INTEGER NOT NULL,
    publishedAt  TEXT NOT NULL,
    publishedBy  INTEGER,
    snapshotJson TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_guest_booklet_versions_property ON guest_booklet_versions(propertyId, id);
  CREATE TABLE IF NOT EXISTS guest_media (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    path      TEXT NOT NULL,
    width     INTEGER,
    height    INTEGER,
    altFr     TEXT,
    altEn     TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS guest_orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    sessionId     INTEGER,
    payment       TEXT NOT NULL CHECK (payment IN ('card', 'note', 'none')),
    status        TEXT NOT NULL CHECK (status IN ('awaiting_payment', 'confirmed', 'paid', 'delivered', 'expired', 'paid_conflict')),
    linesJson     TEXT NOT NULL,
    total         REAL NOT NULL DEFAULT 0,
    deliverAt     TEXT,
    heldUntil     TEXT,
    paymentLinkId INTEGER,
    createdAt     TEXT NOT NULL,
    confirmedAt   TEXT,
    deliveredAt   TEXT,
    deliveredBy   INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_guest_orders_reservation ON guest_orders(reservationId);
  CREATE INDEX IF NOT EXISTS idx_guest_orders_held ON guest_orders(heldUntil);
`;

const TABLES = Object.freeze([
  'guest_app_lodgings', 'guest_app_items', 'guest_app_service_hours', 'guest_app_service_exceptions',
  'guest_sessions', 'guest_stay_links', 'guest_booklet_pages', 'guest_booklet_placements', 'guest_booklet_blocks',
  'guest_booklet_versions', 'guest_media', 'guest_orders',
]);

const MIGRATIONS = Object.freeze([
  { name: 'guest_app_tables_v1', up: (db) => db.exec(TABLES_SQL) },
]);

module.exports = { MIGRATIONS, TABLES };
