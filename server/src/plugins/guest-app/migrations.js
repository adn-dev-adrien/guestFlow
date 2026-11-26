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
    stockTracked       INTEGER NOT NULL DEFAULT 0,
    stockQuantity      INTEGER,
    stockSetAt         TEXT,
    stockSetBy         TEXT,
    stockSetQuantity   INTEGER,
    stockAlertBelow    INTEGER,
    soldOut            INTEGER NOT NULL DEFAULT 0,
    stockLowPushedAt   TEXT,
    stockOutPushedAt   TEXT,
    PRIMARY KEY (kind, itemId)
  );
  CREATE TABLE IF NOT EXISTS guest_app_stock_counts (
    reservationId INTEGER NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('option', 'resource')),
    itemId        INTEGER NOT NULL,
    quantity      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (reservationId, kind, itemId)
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
    status        TEXT NOT NULL CHECK (status IN ('awaiting_payment', 'confirmed', 'paid', 'delivered', 'expired', 'paid_conflict', 'abandoned')),
    linesJson     TEXT NOT NULL,
    total         REAL NOT NULL DEFAULT 0,
    deliverAt     TEXT,
    deliverMoved  INTEGER NOT NULL DEFAULT 0,
    fulfilment    TEXT NOT NULL DEFAULT 'delivery' CHECK (fulfilment IN ('delivery', 'pickup')),
    pickupPlace   TEXT,
    heldUntil     TEXT,
    paymentLinkId INTEGER,
    paymentUrl    TEXT,
    createdAt     TEXT NOT NULL,
    confirmedAt   TEXT,
    paidAt        TEXT,
    closedAt      TEXT,
    deliveredAt   TEXT,
    deliveredBy   INTEGER,
    deferredCents INTEGER NOT NULL DEFAULT 0,
    clientKey     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_guest_orders_reservation ON guest_orders(reservationId);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_orders_client_key ON guest_orders(sessionId, clientKey) WHERE clientKey IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_guest_orders_held ON guest_orders(heldUntil);
  CREATE INDEX IF NOT EXISTS idx_guest_orders_status ON guest_orders(status, deliverAt);
`;

// specs/guest-app-home-automation.md §5 — one row per lodging and block kind, in the order the guest sees them.
const HOME_BLOCKS_SQL = `
  CREATE TABLE IF NOT EXISTS guest_home_blocks (
    propertyId  INTEGER NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('outdoor', 'rooms', 'lights', 'rain', 'energy')),
    position    INTEGER NOT NULL,
    "on"        INTEGER NOT NULL DEFAULT 0,
    equipmentId TEXT,
    itemsJson   TEXT NOT NULL DEFAULT '[]',
    updatedAt   TEXT NOT NULL,
    PRIMARY KEY (propertyId, kind)
  );
`;

// specs/guest-app-home-automation.md rule 29 — the « Réseau » block: SQLite cannot widen a CHECK, so the table is
// rebuilt with its rows (the runner wraps each migration in a transaction).
const HOME_BLOCKS_GRID_SQL = `
  CREATE TABLE guest_home_blocks_grid (
    propertyId  INTEGER NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('outdoor', 'rooms', 'lights', 'rain', 'energy', 'grid')),
    position    INTEGER NOT NULL,
    "on"        INTEGER NOT NULL DEFAULT 0,
    equipmentId TEXT,
    itemsJson   TEXT NOT NULL DEFAULT '[]',
    updatedAt   TEXT NOT NULL,
    PRIMARY KEY (propertyId, kind)
  );
  INSERT INTO guest_home_blocks_grid (propertyId, kind, position, "on", equipmentId, itemsJson, updatedAt)
    SELECT propertyId, kind, position, "on", equipmentId, itemsJson, updatedAt FROM guest_home_blocks;
  DROP TABLE guest_home_blocks;
  ALTER TABLE guest_home_blocks_grid RENAME TO guest_home_blocks;
`;

// specs/guest-app/guest-app-local-amenities.md §5 — the estate's shops, services and waste points; a new table, nothing existing is touched.
const PLACES_SQL = `
  CREATE TABLE IF NOT EXISTS guest_app_places (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    category       TEXT NOT NULL,
    name_fr        TEXT NOT NULL,
    name_en        TEXT,
    commune        TEXT NOT NULL,
    lat            REAL NOT NULL,
    lng            REAL NOT NULL,
    drive_minutes  INTEGER NOT NULL,
    waste_kind     TEXT,
    accepts        TEXT,
    energies       TEXT,
    phone          TEXT,
    note_fr        TEXT,
    note_en        TEXT,
    hours          TEXT,
    published      INTEGER NOT NULL DEFAULT 1,
    verified_on    TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_guest_app_places_published ON guest_app_places(published, category);
`;

const TABLES = Object.freeze([
  'guest_app_lodgings', 'guest_app_items', 'guest_app_stock_counts', 'guest_app_service_hours', 'guest_app_service_exceptions',
  'guest_sessions', 'guest_stay_links', 'guest_booklet_pages', 'guest_booklet_placements', 'guest_booklet_blocks',
  'guest_booklet_versions', 'guest_media', 'guest_orders', 'guest_home_blocks', 'guest_app_places',
]);

// Rule 66 — where an order is collected: the arrival complement (taken before the arrival is marked) or the departure
// one. Every earlier order was collected at the departure or by card.
const addCollectAt = (db) => {
  if (db.prepare('PRAGMA table_info(guest_orders)').all().some((c) => c.name === 'collectAt')) return;
  db.exec("ALTER TABLE guest_orders ADD COLUMN collectAt TEXT NOT NULL DEFAULT 'departure' CHECK (collectAt IN ('arrival', 'departure'))");
};

// Rules 72, 87 — an order of a cancelled stay (or emptied at the arrival SAS) is `cancelled`; its amendments are its own
// history. The status CHECK cannot be altered in place, so the table is rebuilt in the migration's transaction, rows
// copied, indexes recreated. Idempotent: a table that already holds the new status is left alone.
const rebuildOrdersWithCancelled = (db) => {
  const stored = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'guest_orders'").get();
  if (!stored || String(stored.sql).includes("'cancelled'")) return;
  const columns = db.prepare('PRAGMA table_info(guest_orders)').all().map((c) => c.name);
  const copied = columns.join(', ');
  db.exec(`
    CREATE TABLE guest_orders_v3 (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      reservationId INTEGER NOT NULL,
      sessionId     INTEGER,
      payment       TEXT NOT NULL CHECK (payment IN ('card', 'note', 'none')),
      status        TEXT NOT NULL CHECK (status IN ('awaiting_payment', 'confirmed', 'paid', 'delivered', 'expired', 'paid_conflict', 'abandoned', 'cancelled')),
      linesJson     TEXT NOT NULL,
      total         REAL NOT NULL DEFAULT 0,
      deliverAt     TEXT,
      deliverMoved  INTEGER NOT NULL DEFAULT 0,
      fulfilment    TEXT NOT NULL DEFAULT 'delivery' CHECK (fulfilment IN ('delivery', 'pickup')),
      pickupPlace   TEXT,
      heldUntil     TEXT,
      paymentLinkId INTEGER,
      paymentUrl    TEXT,
      createdAt     TEXT NOT NULL,
      confirmedAt   TEXT,
      paidAt        TEXT,
      closedAt      TEXT,
      deliveredAt   TEXT,
      deliveredBy   INTEGER,
      deferredCents INTEGER NOT NULL DEFAULT 0,
      clientKey     TEXT,
      collectAt     TEXT NOT NULL DEFAULT 'departure' CHECK (collectAt IN ('arrival', 'departure')),
      cancelledAt   TEXT,
      cancelReason  TEXT,
      amendmentsJson TEXT
    );
    INSERT INTO guest_orders_v3 (${copied}) SELECT ${copied} FROM guest_orders;
    DROP TABLE guest_orders;
    ALTER TABLE guest_orders_v3 RENAME TO guest_orders;
    CREATE INDEX IF NOT EXISTS idx_guest_orders_reservation ON guest_orders(reservationId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_orders_client_key ON guest_orders(sessionId, clientKey) WHERE clientKey IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_guest_orders_held ON guest_orders(heldUntil);
    CREATE INDEX IF NOT EXISTS idx_guest_orders_status ON guest_orders(status, deliverAt);
  `);
};

// Rule 107 — « offert déjà en place à l'arrivée »: NULL follows the article's class (drinks: on), 1 / 0 is the operator's word.
const ORDER_REF_SOURCES = ['reservation_options', 'reservation_resources', 'reservation_custom_options'].map((table) => ({ table, column: 'orderRef' }));

const addOfferedInPlace = (db) => {
  if (db.prepare('PRAGMA table_info(guest_app_items)').all().some((c) => c.name === 'offeredInPlace')) return;
  db.exec('ALTER TABLE guest_app_items ADD COLUMN offeredInPlace INTEGER CHECK (offeredInPlace IN (0, 1))');
};

// specs/plugin-removal-resilience.md rule 22 — after an erase and a reinstall the id counter restarts above the orders the stays' lines still cite,
// and above the orders a card payment link still names (an unpaid order is cited by its link only, rule 108; loop t2 D2-2).
const keepOrderIdsCited = (db) => {
  const { highestCitedId, highestBasketRef, raiseCounter } = require('../sdk/citedIdCounterFloor');
  raiseCounter(db, 'guest_orders', Math.max(highestCitedId(db, 'order:', ORDER_REF_SOURCES), highestBasketRef(db, 'guestOrder')));
};

const MIGRATIONS = Object.freeze([
  { name: 'guest_app_tables_v1', up: (db) => db.exec(TABLES_SQL) },
  { name: 'guest_home_blocks_v1', up: (db) => db.exec(HOME_BLOCKS_SQL) },
  { name: 'guest_home_blocks_grid_v1', up: (db) => db.exec(HOME_BLOCKS_GRID_SQL) },
  { name: 'guest_app_orders_collect_at_v2', up: addCollectAt },
  { name: 'guest_app_orders_status_v3', up: rebuildOrdersWithCancelled },
  { name: 'guest_app_items_offered_in_place_v4', up: addOfferedInPlace },
  { name: 'guest_orders_counter_floor_v5', up: keepOrderIdsCited },
  { name: 'guest_app_places_v6', up: (db) => db.exec(PLACES_SQL) },
]);

module.exports = { MIGRATIONS, TABLES };
