const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// Per-item routing to Complément (spec force-item-to-complement.md).
// Exercises: `inComplement` flag on options/resources/custom + `touristTaxInComplement` at the
// reservation level + per-line `acompteContribTtc` / `soldeContribTtc` flowing through to
// `quote.optionLines[i]` / `quote.resourceLines[i]`.

function createDb({ withTax = false, withOption = false, withResource = false } = {}) {
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
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare('INSERT INTO properties (id, name, touristTaxPerDayPerPerson) VALUES (1, ?, ?)')
    .run('Logement', withTax ? 1 : 0);
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  if (withOption) {
    db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Lit supp.', 'per_stay', 50)").run();
    db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  }
  if (withResource) {
    db.prepare("INSERT INTO resources (id, name, quantity, price, priceType) VALUES (20, 'Vélo', 5, 30, 'per_stay')").run();
  }
  return db;
}

const BASE_INPUTS = {
  propertyId: 1,
  startDate: '2026-07-10',
  endDate: '2026-07-12', // 2 nights × 100 = 200 €
  checkInTime: '15:00',
  checkOutTime: '10:00',
  adults: 2,
  children: 0,
  teens: 0,
  selectedOptions: [],
  customOptions: [],
  selectedResources: [],
  discountPercent: 0,
  customPrice: '',
};

test('baseline: no flag, no payment → identical math as legacy (regression guard)', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE_INPUTS, db });
  assert.equal(q.finalPrice, 200);
  assert.equal(q.depositAmount + q.balanceAmount, q.totalStayPrice);
  assert.equal(q.complementAmount, 0);
  assert.equal(q.forcedItemsTotal, 0);
  assert.equal(q.touristTaxInComplement, false);
  db.close();
});

test('forced option → engine drops it from preArrival + auto deposit, complement carries it', () => {
  const db = createDb({ withOption: true });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 1 }],
  });
  // Stay = 200 (accommodation) + 50 (option) = 250. Forced option not in preArrival.
  assert.equal(q.forcedItemsTotal, 50);
  assert.equal(q.preArrivalAmount, 200);
  assert.equal(q.depositAmount + q.balanceAmount, 200); // 30% / 70% split on 200 only
  assert.equal(q.complementAmount, 50);
  assert.equal(q.optionLines.find((l) => l.optionId === 10).inComplement, 1);
  db.close();
});

test('non-forced option flows into preArrival auto split (default behaviour preserved)', () => {
  const db = createDb({ withOption: true });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 0 }],
  });
  assert.equal(q.forcedItemsTotal, 0);
  assert.equal(q.preArrivalAmount, 250);
  assert.equal(q.depositAmount + q.balanceAmount, 250);
  assert.equal(q.complementAmount, 0);
  assert.equal(q.optionLines.find((l) => l.optionId === 10).inComplement, 0);
  db.close();
});

test('touristTaxInComplement on direct → tax bypasses preArrival, lands in complement', () => {
  const db = createDb({ withTax: true });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    platform: 'direct',
    touristTaxInComplement: 1,
  });
  // Stay 200 + tax (2 adults × 2 nights × 1€ = 4€). preArrival = 200 only.
  assert.equal(q.touristTaxTotal, 4);
  assert.equal(q.preArrivalAmount, 200);
  assert.equal(q.depositAmount + q.balanceAmount, 200);
  assert.equal(q.complementAmount, 4);
  assert.equal(q.touristTaxInComplement, true);
  db.close();
});

test('forced option + forced tax → complement = both, preArrival = accommodation only', () => {
  const db = createDb({ withTax: true, withOption: true });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    platform: 'direct',
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 1 }],
    touristTaxInComplement: 1,
  });
  assert.equal(q.forcedItemsTotal, 50);
  assert.equal(q.preArrivalAmount, 200);
  assert.equal(q.complementAmount, 50 + 4);
  db.close();
});

test('forced resource → routed identically to forced option', () => {
  const db = createDb({ withResource: true });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    selectedResources: [{ resourceId: 20, quantity: 1, inComplement: 1 }],
  });
  assert.equal(q.forcedItemsTotal, 30);
  assert.equal(q.preArrivalAmount, 200);
  assert.equal(q.complementAmount, 30);
  db.close();
});

test('locked per-line contribs pass through unchanged into quote.optionLines[i]', () => {
  const db = createDb({ withOption: true });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    selectedOptions: [{ optionId: 10, quantity: 1 }],
    lockedOptionLines: [{
      optionId: 10, quantity: 1, unitPrice: 50, billedUnits: 1, priceType: 'per_stay',
      totalPrice: 50, offered: 0, inComplement: 0,
      acompteContribTtc: 15, soldeContribTtc: 35,
    }],
  });
  const line = q.optionLines.find((l) => l.optionId === 10);
  assert.equal(line.acompteContribTtc, 15);
  assert.equal(line.soldeContribTtc, 35);
});

test('locked contribs flagged forced are dropped in the auto split (forced takes precedence)', () => {
  const db = createDb({ withOption: true });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 1 }],
    lockedOptionLines: [{
      optionId: 10, quantity: 1, unitPrice: 50, billedUnits: 1, priceType: 'per_stay',
      totalPrice: 50, offered: 0, inComplement: 1,
      acompteContribTtc: 15, soldeContribTtc: 35,
    }],
  });
  // Forced → preArrival drops the line.
  assert.equal(q.preArrivalAmount, 200);
  assert.equal(q.complementAmount, 50);
});

test('flag toggling between non-forced and forced changes preArrival deterministically', () => {
  const db = createDb({ withOption: true });
  const inputs = { ...BASE_INPUTS, db, selectedOptions: [{ optionId: 10, quantity: 1 }] };
  const off = calculateReservationQuote({ ...inputs, selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 0 }] });
  const on = calculateReservationQuote({ ...inputs, selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 1 }] });
  assert.equal(off.preArrivalAmount, 250);
  assert.equal(on.preArrivalAmount, 200);
  assert.equal(off.complementAmount, 0);
  assert.equal(on.complementAmount, 50);
});

test('offered + forced → contributes 0 everywhere (forced flag overrides empty totalPrice)', () => {
  const db = createDb({ withOption: true });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 1 }],
    offeredOptionIds: [10],
  });
  // Offered → totalPrice 0 → forcedItemsTotal 0 → complement = 0
  const line = q.optionLines.find((l) => l.optionId === 10);
  assert.equal(line.totalPrice, 0);
  assert.equal(line.inComplement, 1);
  assert.equal(q.forcedItemsTotal, 0);
  assert.equal(q.complementAmount, 0);
});

test('custom option forced → routed identically', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    customOptions: [{ description: 'Late checkout', amount: 30, inComplement: 1 }],
  });
  assert.equal(q.forcedItemsTotal, 30);
  assert.equal(q.preArrivalAmount, 200);
  assert.equal(q.complementAmount, 30);
});

test('platform that collects tax → touristTaxInComplement is moot (tax was 0 already)', () => {
  const db = createDb({ withTax: true });
  // platform-collect → engine zeroes touristTaxTotal upstream (via isPlatformCollectingTouristTax),
  // so the routing flag has nothing to route. We just check the engine doesn't crash + complement
  // reflects no tax movement.
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    platform: 'direct', // direct keeps tax visible
    touristTaxInComplement: 0,
  });
  assert.equal(q.touristTaxTotal, 4);
  assert.equal(q.preArrivalAmount, 204);
  assert.equal(q.complementAmount, 0);
});

test('both paid + grown option → autoGap appears + forced part keeps its share', () => {
  const db = createDb({ withOption: true });
  // depositAmount + balanceAmount frozen at 60 / 140 (300€ stay), then option grew to 100.
  // Stay now 200 + 100 = 300. forced = 0. autoGap = 300 - 60 - 140 - 0 = 100.
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 0 }],
    depositPaid: true, balancePaid: true,
    depositAmount: 60, balanceAmount: 140,
    lockedOptionLines: [{
      optionId: 10, quantity: 1, unitPrice: 50, billedUnits: 1, priceType: 'per_stay',
      totalPrice: 100, offered: 0, inComplement: 0,
    }],
  });
  assert.equal(q.depositAmount, 60);
  assert.equal(q.balanceAmount, 140);
  assert.equal(q.complementAmount, 100);
});

test('forced + 2x same option → forcedItemsTotal counts the full quantity', () => {
  const db = createDb({ withOption: true });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    selectedOptions: [{ optionId: 10, quantity: 2, inComplement: 1 }],
  });
  assert.equal(q.forcedItemsTotal, 100);
  assert.equal(q.complementAmount, 100);
});

test('payload `inComplement` always wins over locked snapshot (operator can re-route)', () => {
  const db = createDb({ withOption: true });
  // Locked says forced=1, payload toggles it off → engine treats as non-forced.
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 0 }],
    lockedOptionLines: [{
      optionId: 10, quantity: 1, unitPrice: 50, billedUnits: 1, priceType: 'per_stay',
      totalPrice: 50, offered: 0, inComplement: 1,
    }],
  });
  assert.equal(q.forcedItemsTotal, 0);
  assert.equal(q.preArrivalAmount, 250);
});

// Auto-options (early check-in / late check-out) live in a parallel channel because they
// aren't part of `selectedOptions` — the engine derives them from `option.autoEnabled = 1`.
// The user routes them to Complément by listing their optionId in `autoOptionsInComplement`.

function createDbWithAutoOption() {
  const db = createDb();
  // Late check-out option that auto-fires on every reservation, fixed 25 €.
  db.prepare("INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold) VALUES (20, 'Départ tardif', 'per_stay', 25, 'late_check_out', 1, 'fixed', '17:00')").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 20)').run();
  return db;
}

test('auto-option not in autoOptionsInComplement → stays in the deposit/balance split', () => {
  const db = createDbWithAutoOption();
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, checkOutTime: '18:00' });
  const lateLine = q.optionLines.find((l) => l.optionId === 20);
  assert.ok(lateLine, 'late check-out auto-option must appear in optionLines');
  assert.equal(lateLine.inComplement, 0);
  assert.equal(q.forcedItemsTotal, 0);
});

test('auto-option in autoOptionsInComplement → routed to Complément (preArrival drops it)', () => {
  const db = createDbWithAutoOption();
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    checkOutTime: '18:00',
    autoOptionsInComplement: [20],
  });
  const lateLine = q.optionLines.find((l) => l.optionId === 20);
  assert.equal(lateLine.inComplement, 1);
  // Stay 200 + 25 auto = 225. Forced → preArrival = 200 (excluding late check-out).
  assert.equal(q.forcedItemsTotal, 25);
  assert.equal(q.preArrivalAmount, 200);
  assert.equal(q.complementAmount, 25);
});

test('auto-option locked with inComplement=1 in DB is still forced even without the payload signal', () => {
  // Backward-compat: a reservation saved with the auto-option already flagged in `reservation_options`
  // (e.g. from a previous payment) keeps its routing even if the client forgets to send the array.
  const db = createDbWithAutoOption();
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    checkOutTime: '18:00',
    lockedOptionLines: [{
      optionId: 20, quantity: 1, unitPrice: 25, billedUnits: 1, priceType: 'per_stay',
      totalPrice: 25, offered: 0, inComplement: 1,
    }],
  });
  const lateLine = q.optionLines.find((l) => l.optionId === 20);
  assert.equal(lateLine.inComplement, 1);
  assert.equal(q.forcedItemsTotal, 25);
});

test('auto-option forced → contribs are cleared to NULL (line lives 100 % in Complément)', () => {
  const db = createDbWithAutoOption();
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    checkOutTime: '18:00',
    autoOptionsInComplement: [20],
    lockedOptionLines: [{
      optionId: 20, quantity: 1, unitPrice: 25, billedUnits: 1, priceType: 'per_stay',
      totalPrice: 25, offered: 0, inComplement: 0,
      acompteContribTtc: 7, soldeContribTtc: 18,
    }],
  });
  const lateLine = q.optionLines.find((l) => l.optionId === 20);
  // Forced override → contribs cleared so the legacy split is no longer applicable.
  assert.equal(lateLine.inComplement, 1);
  assert.equal(lateLine.acompteContribTtc, null);
  assert.equal(lateLine.soldeContribTtc, null);
});

// ── specs/force-extras-complement-on-platform.md §3 rule 1bis: platform default + operator override ──
// On a non-direct platform reservation an extra DEFAULTS into Complément when the line carries no
// explicit flag (a freshly-added line), but an explicit per-line `inComplement` always wins so the
// operator can pull a line back out of Complément.

test('platform + unflagged option → defaults into Complément', () => {
  const db = createDb({ withOption: true });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    platform: 'Airbnb',
    selectedOptions: [{ optionId: 10, quantity: 1 }], // no inComplement flag
  });
  assert.equal(q.optionLines.find((l) => l.optionId === 10).inComplement, 1);
  assert.equal(q.forcedItemsTotal, 50);
  assert.equal(q.preArrivalAmount, 200);
  db.close();
});

test('platform + explicit inComplement = 0 → operator override wins (line leaves Complément)', () => {
  const db = createDb({ withOption: true });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    platform: 'Airbnb',
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 0 }],
  });
  assert.equal(q.optionLines.find((l) => l.optionId === 10).inComplement, 0);
  assert.equal(q.forcedItemsTotal, 0);
  assert.equal(q.preArrivalAmount, 250); // option folded back into the auto deposit/balance split
  assert.equal(q.complementAmount, 0);
  db.close();
});

test('platform + unflagged resource → defaults into Complément', () => {
  const db = createDb({ withResource: true });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    platform: 'Booking',
    selectedResources: [{ resourceId: 20, quantity: 1 }],
  });
  assert.equal(q.resourceLines.find((l) => l.resourceId === 20).inComplement, 1);
  assert.equal(q.forcedItemsTotal, 30);
  db.close();
});

test('platform + explicit resource inComplement = 0 → override wins', () => {
  const db = createDb({ withResource: true });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    platform: 'Booking',
    selectedResources: [{ resourceId: 20, quantity: 1, inComplement: 0 }],
  });
  assert.equal(q.resourceLines.find((l) => l.resourceId === 20).inComplement, 0);
  assert.equal(q.forcedItemsTotal, 0);
  db.close();
});

test('platform + unflagged custom option → defaults into Complément; explicit 0 overrides', () => {
  const db = createDb();
  const def = calculateReservationQuote({
    ...BASE_INPUTS, db,
    platform: 'Airbnb',
    customOptions: [{ description: 'Panier bienvenue', amount: 30 }],
  });
  assert.equal(def.optionLines.find((l) => l.isCustom).inComplement, 1);
  const override = calculateReservationQuote({
    ...BASE_INPUTS, db,
    platform: 'Airbnb',
    customOptions: [{ description: 'Panier bienvenue', amount: 30, inComplement: 0 }],
  });
  assert.equal(override.optionLines.find((l) => l.isCustom).inComplement, 0);
  db.close();
});
