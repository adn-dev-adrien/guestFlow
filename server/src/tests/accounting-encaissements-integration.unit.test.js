const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createAccountingModel } = require('../models/accountingModel');
const { create: createAccountingController } = require('../controllers/accountingController');

// Integration-style regression tests for the two prod bugs Adrien spotted 2026-06-02:
//   (1) "phantom tout à zéro" entry duplicating a reservation when `*Paid = 1` but the
//       corresponding `*Amount = 0` (typical cause: depositDisabled toggled ON after the
//       user clicked "Marquer acompte payé").
//   (2) direct bookings missing from the platforms-table preview (used to filter
//       `e.platform !== 'direct'`).
//
// These tests drive the real `encaissementsByMonth` model + `platformsPreview` controller
// against a minimal in-memory schema — the highest-signal regression coverage because they
// exercise the end-to-end path the prod bug took.

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0
    );
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard',
      pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1
    );
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT, price REAL, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER, price REAL, priceType TEXT, isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRateAccommodation REAL, vatRateStandard REAL);
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY, propertyId INTEGER, clientId INTEGER, kind TEXT DEFAULT 'reservation',
      startDate TEXT, endDate TEXT, checkInTime TEXT DEFAULT '15:00', checkOutTime TEXT DEFAULT '10:00',
      adults INTEGER DEFAULT 2, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
      platform TEXT DEFAULT 'direct', discountPercent REAL DEFAULT 0, customPrice REAL,
      depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositPaidDate TEXT,
      balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balancePaidDate TEXT,
      complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidDate TEXT,
      finalPrice REAL DEFAULT 0, clientGrossAmount REAL,
      totalPrice REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0, touristTaxRate REAL DEFAULT 0,
      touristTaxInComplement INTEGER DEFAULT 0, extraGuestSurchargeOffered INTEGER DEFAULT 0,
      accommodationAcompteContribTtc REAL, accommodationSoldeContribTtc REAL,
      touristTaxAcompteContribTtc REAL, touristTaxSoldeContribTtc REAL
    );
    CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity REAL, billedUnits REAL, unitPrice REAL, priceType TEXT, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, PRIMARY KEY (reservationId, optionId));
    CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL);
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, quantity REAL, billedUnits REAL, unitPrice REAL, priceType TEXT, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, PRIMARY KEY (reservationId, resourceId));
    CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL, PRIMARY KEY (reservationId, date));
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER, platformKey TEXT, collectsTouristTax INTEGER DEFAULT 1);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRateAccommodation, vatRateStandard) VALUES (1, 10, 20)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Le Petit Gîte')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (2, 'La Maison du Lac')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId) VALUES (1, 1)').run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId) VALUES (2, 2)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (2, 'Alice', 'Martin')").run();
  return db;
}

function insertReservation(db, overrides = {}) {
  const r = {
    id: null, propertyId: 1, clientId: 1,
    startDate: '2026-08-10', endDate: '2026-08-12',
    platform: 'direct',
    finalPrice: 200, totalPrice: 200,
    depositAmount: 0, depositPaid: 0, depositPaidDate: null,
    balanceAmount: 0, balancePaid: 0, balancePaidDate: null,
    complementAmount: 0, complementPaid: 0, complementPaidDate: null,
    clientGrossAmount: null,
    ...overrides,
  };
  const cols = Object.keys(r).filter((k) => r[k] !== null || k.endsWith('Date') || k === 'clientGrossAmount').join(', ');
  const placeholders = cols.split(', ').map(() => '?').join(', ');
  const values = cols.split(', ').map((k) => r[k]);
  return db.prepare(`INSERT INTO reservations (${cols}) VALUES (${placeholders})`).run(...values).lastInsertRowid;
}

// ── Bug 1 regression: phantom "tout à zéro" ──────────────────────────────────

test('depositDisabled + accidentally-paid deposit: only the balance entry is emitted (no phantom zero deposit)', () => {
  // Exact dev-server shape Adrien hit: depositDisabled flow leaves depositAmount = 0, but the
  // user clicked "Marquer acompte payé" before disabling → depositPaid = 1 + depositPaidDate
  // in the month. Pre-fix: TWO entries (one with money for balance, one all-zero for deposit).
  const db = createDb();
  insertReservation(db, {
    depositAmount: 0,  depositPaid: 1, depositPaidDate: '2026-08-15',
    balanceAmount: 200, balancePaid: 1, balancePaidDate: '2026-08-15',
  });
  const model = createAccountingModel(db);
  const entries = model.encaissementsByMonth({ month: 8, year: 2026 });
  assert.equal(entries.length, 1, 'only the balance entry should be emitted');
  assert.equal(entries[0].kind, 'balance');
  assert.equal(entries[0].encaissementTtc, 200);
});

test('complementPaid = 1 with complementAmount = 0: no phantom complement entry', () => {
  // Symmetric: a user accidentally flipped complementPaid on a reservation where the
  // complement amount was 0. The phantom complement entry must not be emitted.
  const db = createDb();
  insertReservation(db, {
    depositAmount: 60,  depositPaid: 1, depositPaidDate: '2026-08-15',
    balanceAmount: 140, balancePaid: 1, balancePaidDate: '2026-08-15',
    complementAmount: 0, complementPaid: 1, complementPaidDate: '2026-08-15',
  });
  const model = createAccountingModel(db);
  const entries = model.encaissementsByMonth({ month: 8, year: 2026 });
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.kind).sort(), ['balance', 'deposit']);
});

test('reservation with all three amounts = 0: emits zero entries (NOT three phantom rows)', () => {
  // Pathological case: someone marked all three buckets paid but every amount stayed 0.
  // Pre-fix: three "balanced but empty" entries appeared in the journal preview.
  const db = createDb();
  insertReservation(db, {
    depositAmount: 0, depositPaid: 1, depositPaidDate: '2026-08-15',
    balanceAmount: 0, balancePaid: 1, balancePaidDate: '2026-08-15',
    complementAmount: 0, complementPaid: 1, complementPaidDate: '2026-08-15',
  });
  const model = createAccountingModel(db);
  const entries = model.encaissementsByMonth({ month: 8, year: 2026 });
  assert.equal(entries.length, 0);
});

test('normal deposit + balance flow (regression guard): both entries emitted with non-zero amounts', () => {
  // Sanity that the new null-guard doesn't accidentally drop legitimate entries.
  const db = createDb();
  insertReservation(db, {
    depositAmount: 60, depositPaid: 1, depositPaidDate: '2026-08-15',
    balanceAmount: 140, balancePaid: 1, balancePaidDate: '2026-08-15',
  });
  const model = createAccountingModel(db);
  const entries = model.encaissementsByMonth({ month: 8, year: 2026 });
  assert.equal(entries.length, 2);
  const byKind = Object.fromEntries(entries.map((e) => [e.kind, e]));
  assert.equal(byKind.deposit.encaissementTtc, 60);
  assert.equal(byKind.balance.encaissementTtc, 140);
});

// ── Bug 2 regression: direct bookings missing from platforms preview ─────────

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('platformsPreview includes direct bookings alongside platform ones', () => {
  const db = createDb();
  // Direct booking on property #1 (Le Petit Gîte) — full balance paid in month.
  insertReservation(db, {
    propertyId: 1, clientId: 1, platform: 'direct',
    balanceAmount: 200, balancePaid: 1, balancePaidDate: '2026-08-12',
  });
  // Non-direct booking (airbnb) on property #2 (La Maison du Lac).
  insertReservation(db, {
    propertyId: 2, clientId: 2, platform: 'airbnb',
    finalPrice: 300, totalPrice: 300, clientGrossAmount: 360,
    balanceAmount: 300, balancePaid: 1, balancePaidDate: '2026-08-20',
  });
  const controller = createAccountingController(createAccountingModel(db));
  const res = mockRes();
  controller.platformsPreview({ query: { month: '8', year: '2026' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.rows.length, 2, 'direct AND airbnb rows must both appear');
  const platforms = res.body.rows.map((r) => r.platform).sort();
  assert.deepEqual(platforms, ['airbnb', 'direct']);
});

test('platformsPreview: direct rows have null gross + null commission (rendered as "—" by the UI)', () => {
  const db = createDb();
  insertReservation(db, {
    propertyId: 1, platform: 'direct',
    balanceAmount: 200, balancePaid: 1, balancePaidDate: '2026-08-12',
  });
  const controller = createAccountingController(createAccountingModel(db));
  const res = mockRes();
  controller.platformsPreview({ query: { month: '8', year: '2026' } }, res);
  const directRow = res.body.rows.find((r) => r.platform === 'direct');
  assert.ok(directRow);
  assert.equal(directRow.gross, null);
  assert.equal(directRow.commission, null);
  // But encaissement IS populated.
  assert.equal(directRow.encaissement, 200);
});

test('platformsPreview totalCommission aggregates ONLY non-direct rows', () => {
  const db = createDb();
  // Two direct (no commission), one airbnb with commission. Pricing rule is 100 €/night and
  // every reservation spans 2 nights → finalPrice (re-computed by the engine) = 200. For the
  // airbnb row we set clientGrossAmount = 240 → commission = 240 − 200 = 40.
  insertReservation(db, {
    propertyId: 1, platform: 'direct',
    balanceAmount: 200, balancePaid: 1, balancePaidDate: '2026-08-12',
  });
  insertReservation(db, {
    propertyId: 2, platform: 'direct',
    balanceAmount: 200, balancePaid: 1, balancePaidDate: '2026-08-14',
  });
  insertReservation(db, {
    propertyId: 1, clientId: 2, platform: 'airbnb',
    clientGrossAmount: 240,
    balanceAmount: 200, balancePaid: 1, balancePaidDate: '2026-08-20',
  });
  const controller = createAccountingController(createAccountingModel(db));
  const res = mockRes();
  controller.platformsPreview({ query: { month: '8', year: '2026' } }, res);
  assert.equal(res.body.rows.length, 3);
  assert.equal(res.body.totalCommission, 40); // only the airbnb row contributes
});

test('platformsPreview: zero-amount entries are also filtered at the row level (bug 1 + bug 2 interaction)', () => {
  // A direct booking with depositDisabled + accidentally-paid deposit (bug 1 shape) must not
  // produce a phantom direct row in the platforms table either. Pin the interaction.
  const db = createDb();
  insertReservation(db, {
    platform: 'direct',
    depositAmount: 0,  depositPaid: 1, depositPaidDate: '2026-08-15',
    balanceAmount: 200, balancePaid: 1, balancePaidDate: '2026-08-15',
  });
  const controller = createAccountingController(createAccountingModel(db));
  const res = mockRes();
  controller.platformsPreview({ query: { month: '8', year: '2026' } }, res);
  assert.equal(res.body.rows.length, 1, 'only the balance row, not a phantom zero deposit');
  assert.equal(res.body.rows[0].encaissement, 200);
});

test('platformsPreview: propertyName flows end-to-end through the legacy path (bug 1 sibling)', () => {
  // The propertyName field was originally added only to the contrib-driven return shape;
  // legacy reservations (no contribs captured) fell through to the second return path which
  // was missing it. Pin the end-to-end flow against a real DB.
  const db = createDb();
  insertReservation(db, {
    propertyId: 2, // La Maison du Lac
    balanceAmount: 200, balancePaid: 1, balancePaidDate: '2026-08-15',
  });
  const controller = createAccountingController(createAccountingModel(db));
  const res = mockRes();
  controller.platformsPreview({ query: { month: '8', year: '2026' } }, res);
  assert.equal(res.body.rows[0].propertyName, 'La Maison du Lac');
});

test('platformsPreview: reservationId is populated so the AccountingPage row click can navigate', () => {
  const db = createDb();
  const id = insertReservation(db, {
    balanceAmount: 200, balancePaid: 1, balancePaidDate: '2026-08-15',
  });
  const controller = createAccountingController(createAccountingModel(db));
  const res = mockRes();
  controller.platformsPreview({ query: { month: '8', year: '2026' } }, res);
  assert.equal(res.body.rows[0].reservationId, id);
});

test('platformsPreview: empty month → empty rows + zero totalCommission (defensive)', () => {
  const db = createDb();
  const controller = createAccountingController(createAccountingModel(db));
  const res = mockRes();
  controller.platformsPreview({ query: { month: '8', year: '2026' } }, res);
  assert.deepEqual(res.body.rows, []);
  assert.equal(res.body.totalCommission, 0);
});
