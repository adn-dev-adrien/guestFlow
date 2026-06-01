const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { captureContribsOnFlip, clearContribsOnUnflip } = require('../utils/forceItemContribsCapture');

// Per-line per-bucket contribution capture (spec force-item-to-complement.md).
// Drives `captureContribsOnFlip` directly with a minimal in-memory schema; verifies the
// distribution rules + the conservation invariant.

function createDb({ withTax = false } = {}) {
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
    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard',
      pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1
    );
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRateAccommodation REAL, vatRateStandard REAL);
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY, propertyId INTEGER, clientId INTEGER,
      startDate TEXT, endDate TEXT, checkInTime TEXT DEFAULT '15:00', checkOutTime TEXT DEFAULT '10:00',
      adults INTEGER, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
      discountPercent REAL DEFAULT 0, customPrice REAL, finalPrice REAL, totalPrice REAL,
      depositAmount REAL DEFAULT 0, balanceAmount REAL DEFAULT 0, complementAmount REAL DEFAULT 0,
      depositPaid INTEGER DEFAULT 0, balancePaid INTEGER DEFAULT 0, complementPaid INTEGER DEFAULT 0,
      depositPaidDate TEXT, balancePaidDate TEXT, complementPaidDate TEXT,
      touristTaxTotal REAL DEFAULT 0, touristTaxRate REAL DEFAULT 0, platform TEXT DEFAULT 'direct',
      extraGuestSurchargeOffered INTEGER DEFAULT 0,
      touristTaxInComplement INTEGER NOT NULL DEFAULT 0,
      accommodationAcompteContribTtc REAL, accommodationSoldeContribTtc REAL,
      touristTaxAcompteContribTtc REAL, touristTaxSoldeContribTtc REAL
    );
    CREATE TABLE reservation_options (
      reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL DEFAULT 0,
      billedUnits REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', totalPrice REAL DEFAULT 0,
      offered INTEGER DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0,
      acompteContribTtc REAL, soldeContribTtc REAL,
      PRIMARY KEY (reservationId, optionId)
    );
    CREATE TABLE reservation_custom_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER,
      description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0,
      acompteContribTtc REAL, soldeContribTtc REAL
    );
    CREATE TABLE reservation_resources (
      reservationId INTEGER, resourceId INTEGER, quantity REAL DEFAULT 0, unitPrice REAL DEFAULT 0,
      billedUnits REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', totalPrice REAL DEFAULT 0,
      offered INTEGER DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0,
      acompteContribTtc REAL, soldeContribTtc REAL,
      PRIMARY KEY (reservationId, resourceId)
    );
    CREATE TABLE reservation_nights (
      reservationId INTEGER, date TEXT, seasonLabel TEXT DEFAULT 'Standard',
      pricingMode TEXT DEFAULT 'fixed', price REAL DEFAULT 0,
      PRIMARY KEY (reservationId, date)
    );
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER, platformKey TEXT, collectsTouristTax INTEGER DEFAULT 1);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRateAccommodation, vatRateStandard) VALUES (1, 10, 20)').run();
  db.prepare('INSERT INTO properties (id, name, touristTaxPerDayPerPerson) VALUES (1, ?, ?)')
    .run('Logement', withTax ? 1 : 0);
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  return db;
}

function seedReservation(db, overrides = {}) {
  // Default stay: 200€ accommodation (2 nights × 100), no tax, deposit 60 / balance 140 (30%/70%).
  const merged = {
    propertyId: 1, clientId: 1,
    startDate: '2026-07-10', endDate: '2026-07-12',
    adults: 2, finalPrice: 200, totalPrice: 200,
    depositAmount: 60, balanceAmount: 140, complementAmount: 0,
    depositPaid: 0, balancePaid: 0,
    touristTaxTotal: 0, platform: 'direct', touristTaxInComplement: 0,
    ...overrides,
  };
  const cols = Object.keys(merged).join(', ');
  const placeholders = Object.keys(merged).map(() => '?').join(', ');
  const result = db.prepare(`INSERT INTO reservations (${cols}) VALUES (${placeholders})`).run(...Object.values(merged));
  db.prepare('INSERT INTO reservation_nights (reservationId, date, price) VALUES (?, ?, 100), (?, ?, 100)')
    .run(result.lastInsertRowid, '2026-07-10', result.lastInsertRowid, '2026-07-11');
  return result.lastInsertRowid;
}

function getRow(db, id) { return db.prepare('SELECT * FROM reservations WHERE id = ?').get(id); }

test('deposit flip: pure accommodation, no options → all to accommodation contrib', () => {
  const db = createDb();
  const id = seedReservation(db);
  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'deposit' });
  const after = getRow(db, id);
  assert.equal(after.accommodationAcompteContribTtc, 60);
  assert.equal(after.touristTaxAcompteContribTtc, 0);
});

test('deposit flip + option → both share pro-rata at depositPercent', () => {
  const db = createDb();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Lit', 'per_stay', 100)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  // Stay 200 + 100 = 300. deposit 90 (30%), balance 210.
  const id = seedReservation(db, { finalPrice: 300, totalPrice: 200, depositAmount: 90, balanceAmount: 210 });
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, totalPrice) VALUES (?, 10, 1, 100, 1, 100)').run(id);
  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'deposit' });
  const after = getRow(db, id);
  const optRow = db.prepare('SELECT acompteContribTtc FROM reservation_options WHERE reservationId = ?').get(id);
  // depositPercent = 90/300 = 30%. Option = 100 × 30% = 30. Accommodation = 200 × 30% = 60.
  assert.equal(optRow.acompteContribTtc, 30);
  assert.equal(after.accommodationAcompteContribTtc, 60);
  // Conservation: 30 + 60 = 90 ✓
});

test('deposit flip: forced option gets NULL contrib (lives 100 % in complement)', () => {
  const db = createDb();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Lit', 'per_stay', 100)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  // Forced option dropped from preArrival → deposit = 30% of 200 = 60.
  const id = seedReservation(db, { finalPrice: 300, totalPrice: 200, depositAmount: 60, balanceAmount: 140 });
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, totalPrice, inComplement) VALUES (?, 10, 1, 100, 1, 100, 1)').run(id);
  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'deposit' });
  const optRow = db.prepare('SELECT acompteContribTtc FROM reservation_options WHERE reservationId = ?').get(id);
  assert.equal(optRow.acompteContribTtc, null);
  // Accommodation captures the full deposit (60 = 30% of 200).
  const after = getRow(db, id);
  assert.equal(after.accommodationAcompteContribTtc, 60);
});

test('deposit + balance flips sum exactly to depositAmount + balanceAmount (conservation)', () => {
  const db = createDb();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Lit', 'per_stay', 100)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  const id = seedReservation(db, { finalPrice: 300, totalPrice: 200, depositAmount: 90, balanceAmount: 210 });
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, totalPrice) VALUES (?, 10, 1, 100, 1, 100)').run(id);

  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'deposit' });
  db.prepare('UPDATE reservations SET depositPaid = 1 WHERE id = ?').run(id);
  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'balance' });

  const after = getRow(db, id);
  const optRow = db.prepare('SELECT * FROM reservation_options WHERE reservationId = ?').get(id);
  // Acompte: 30 (option) + 60 (acco) = 90 ✓
  // Solde:   70 (option) + 140 (acco) = 210 ✓
  assert.equal(optRow.acompteContribTtc, 30);
  assert.equal(optRow.soldeContribTtc, 70);
  assert.equal(after.accommodationAcompteContribTtc, 60);
  assert.equal(after.accommodationSoldeContribTtc, 140);
});

test('option added between deposit-paid and balance flip → 100 % in solde', () => {
  const db = createDb();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Lit', 'per_stay', 100)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (11, 'Spa', 'per_stay', 50)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10), (1, 11)').run();
  const id = seedReservation(db, { finalPrice: 300, totalPrice: 200, depositAmount: 90, balanceAmount: 210 });
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, totalPrice) VALUES (?, 10, 1, 100, 1, 100)').run(id);
  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'deposit' });
  db.prepare('UPDATE reservations SET depositPaid = 1 WHERE id = ?').run(id);
  // Spa added between deposit-paid and balance flip; finalPrice grows to 350, balance = 260.
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, totalPrice) VALUES (?, 11, 1, 50, 1, 50)').run(id);
  db.prepare('UPDATE reservations SET finalPrice = 350, balanceAmount = 260 WHERE id = ?').run(id);

  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'balance' });
  const lit = db.prepare('SELECT * FROM reservation_options WHERE reservationId = ? AND optionId = 10').get(id);
  const spa = db.prepare('SELECT * FROM reservation_options WHERE reservationId = ? AND optionId = 11').get(id);
  // Lit pre-deposit: solde = 100 - 30 = 70. Spa between: 100 % = 50.
  assert.equal(lit.soldeContribTtc, 70);
  assert.equal(spa.acompteContribTtc, null);
  assert.equal(spa.soldeContribTtc, 50);
});

test('un-flip clears acompte contribs back to NULL across all child + reservation rows', () => {
  const db = createDb();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Lit', 'per_stay', 100)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  const id = seedReservation(db, { finalPrice: 300, totalPrice: 200, depositAmount: 90, balanceAmount: 210 });
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, totalPrice) VALUES (?, 10, 1, 100, 1, 100)').run(id);
  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'deposit' });

  clearContribsOnUnflip({ db, reservationId: id, bucket: 'deposit' });
  const after = getRow(db, id);
  const opt = db.prepare('SELECT acompteContribTtc FROM reservation_options WHERE reservationId = ?').get(id);
  assert.equal(after.accommodationAcompteContribTtc, null);
  assert.equal(after.touristTaxAcompteContribTtc, null);
  assert.equal(opt.acompteContribTtc, null);
});

test('tax-on-arrival → tourist tax contrib stays 0 on the deposit flip (tax in complement)', () => {
  const db = createDb({ withTax: true });
  // Airbnb-style platform that doesn't collect tax → tax-on-arrival path.
  db.prepare('INSERT INTO ical_sources (id, propertyId, platformKey, collectsTouristTax) VALUES (1, 1, ?, 0)').run('airbnb');
  // Stay 200 + tax 4 = 204. tax-on-arrival → preArrival = 200, deposit = 60, balance = 140, complement = 4.
  const id = seedReservation(db, {
    finalPrice: 200, totalPrice: 200, touristTaxTotal: 4, complementAmount: 4,
    depositAmount: 60, balanceAmount: 140, platform: 'airbnb',
  });
  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'deposit' });
  const after = getRow(db, id);
  assert.equal(after.touristTaxAcompteContribTtc, 0);
  assert.equal(after.accommodationAcompteContribTtc, 60);
});

test('touristTaxInComplement on direct → tax contrib stays 0 on both flips', () => {
  const db = createDb({ withTax: true });
  const id = seedReservation(db, {
    finalPrice: 200, totalPrice: 200, touristTaxTotal: 4,
    complementAmount: 4, depositAmount: 60, balanceAmount: 140,
    touristTaxInComplement: 1,
  });
  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'deposit' });
  db.prepare('UPDATE reservations SET depositPaid = 1 WHERE id = ?').run(id);
  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'balance' });
  const after = getRow(db, id);
  assert.equal(after.touristTaxAcompteContribTtc, 0);
  assert.equal(after.touristTaxSoldeContribTtc, 0);
});

test('custom option included in capture (keyed by customOptionId)', () => {
  const db = createDb();
  const id = seedReservation(db, { finalPrice: 250, totalPrice: 200, depositAmount: 75, balanceAmount: 175 });
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, sortOrder) VALUES (?, 'Late checkout', 50, 0)").run(id);

  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'deposit' });
  const custom = db.prepare('SELECT acompteContribTtc FROM reservation_custom_options WHERE reservationId = ?').get(id);
  // depositPercent = 75/250 = 30%. 50 * 30% = 15.
  assert.equal(custom.acompteContribTtc, 15);
});

test('offered option contributes 0 (totalPrice 0 already)', () => {
  const db = createDb();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Free wifi', 'per_stay', 0)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  const id = seedReservation(db);
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, totalPrice, offered) VALUES (?, 10, 1, 0, 1, 0, 1)').run(id);
  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'deposit' });
  const opt = db.prepare('SELECT acompteContribTtc FROM reservation_options WHERE reservationId = ?').get(id);
  assert.equal(opt.acompteContribTtc, 0);
});

test('forced custom option → NULL contrib on both flips', () => {
  const db = createDb();
  const id = seedReservation(db);
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, sortOrder, inComplement) VALUES (?, 'Late checkout', 50, 0, 1)").run(id);
  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'deposit' });
  const custom1 = db.prepare('SELECT acompteContribTtc FROM reservation_custom_options WHERE reservationId = ?').get(id);
  assert.equal(custom1.acompteContribTtc, null);

  db.prepare('UPDATE reservations SET depositPaid = 1 WHERE id = ?').run(id);
  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'balance' });
  const custom2 = db.prepare('SELECT soldeContribTtc FROM reservation_custom_options WHERE reservationId = ?').get(id);
  assert.equal(custom2.soldeContribTtc, null);
});

test('resource forced → NULL contribs preserved', () => {
  const db = createDb();
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType) VALUES (20, 'Vélo', 5, 30, 'per_stay')").run();
  const id = seedReservation(db);
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, totalPrice, inComplement) VALUES (?, 20, 1, 30, 1, 30, 1)').run(id);
  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'deposit' });
  const r = db.prepare('SELECT acompteContribTtc FROM reservation_resources WHERE reservationId = ?').get(id);
  assert.equal(r.acompteContribTtc, null);
});

test('conservation invariant holds within ±0.01 € (rounding absorbed into accommodation)', () => {
  const db = createDb();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Lit', 'per_stay', 33)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (11, 'Spa', 'per_stay', 67)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10), (1, 11)').run();
  // finalPrice = 300, depositAmount = 90 → 30%. Each option × 30% rounds independently.
  const id = seedReservation(db, { finalPrice: 300, totalPrice: 200, depositAmount: 90, balanceAmount: 210 });
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, totalPrice) VALUES (?, 10, 1, 33, 1, 33)').run(id);
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, totalPrice) VALUES (?, 11, 1, 67, 1, 67)').run(id);
  captureContribsOnFlip({ db, reservation: getRow(db, id), bucket: 'deposit' });
  const rows = db.prepare('SELECT acompteContribTtc FROM reservation_options WHERE reservationId = ?').all(id);
  const after = getRow(db, id);
  const sum = rows.reduce((s, r) => s + Number(r.acompteContribTtc), 0) + Number(after.accommodationAcompteContribTtc);
  // Within 1 cent tolerance.
  assert.ok(Math.abs(sum - 90) <= 0.01, `sum=${sum}, expected 90, drift=${Math.abs(sum - 90)}`);
});
