// Planning-card options in the public flow (specs/public-planning-options.md): with
// `planningCardAsQuantity`, the client's quantity is billed as the occurrence count
// (quantity × (perPerson ? persons : 1) × unitPrice) and the line is left unscheduled; without the
// flag (admin), a planning-card option still requires scheduled occurrences.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing');

function seedDb() {
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
    CREATE TABLE options (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
      priceType TEXT NOT NULL DEFAULT 'per_stay', price REAL NOT NULL DEFAULT 0,
      optionProgressiveTiers TEXT NOT NULL DEFAULT '[]', autoOptionType TEXT,
      autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT NOT NULL DEFAULT 'fixed', autoFullNightThreshold TEXT,
      showsPlanningCard INTEGER NOT NULL DEFAULT 0, cardRepeat TEXT DEFAULT 'once_per_day', planningCardTimes TEXT DEFAULT '[]'
    );
    CREATE TABLE property_options ( propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId) );
    CREATE TABLE resources ( id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay', isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]', showsPlanningCard INTEGER NOT NULL DEFAULT 0, slotDuration INTEGER NOT NULL DEFAULT 30, hourlyEveningStart TEXT, hourlyEveningRate REAL NOT NULL DEFAULT 0, openTime TEXT DEFAULT '12:00', closeTime TEXT DEFAULT '22:00', minimumUsageMinutes INTEGER DEFAULT 60 );
    CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte test')").run();
  db.prepare("INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 120, 1)").run();
  // Planning-card option « Petit déjeuner » 8 €, per_person_per_night (perPerson = true).
  db.prepare("INSERT INTO options (id, title, priceType, price, showsPlanningCard) VALUES (6, 'Petit déjeuner', 'per_person_per_night', 8, 1)").run();
  db.prepare("INSERT INTO property_options (propertyId, optionId) VALUES (1, 6)").run();
  // Planning-card option « Location salle » 45 €, per_stay (per group, perPerson = false).
  db.prepare("INSERT INTO options (id, title, priceType, price, showsPlanningCard) VALUES (7, 'Location salle', 'per_stay', 45, 1)").run();
  db.prepare("INSERT INTO property_options (propertyId, optionId) VALUES (1, 7)").run();
  return db;
}

const STAY = { propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-13', adults: 2, children: 0, teens: 0, babies: 0 };

function quote(db, over) {
  return calculateReservationQuote({ db, ...STAY, ...over });
}

test('public flow: per-person planning option billed quantity × persons × unitPrice (occurrence count)', () => {
  const q = quote(seedDb(), { selectedOptions: [{ optionId: 6, quantity: 2 }], planningCardAsQuantity: true });
  const line = q.optionLines.find((l) => l.optionId === 6);
  assert.ok(line, 'the planning-card option is billed, not dropped');
  assert.equal(line.quantity, 2);
  assert.equal(line.billedUnits, 4); // 2 séances × 2 personnes
  assert.equal(line.totalPrice, 32); // 4 × 8 €
  assert.deepEqual(line.cardOccurrences, [], 'left unscheduled');
  assert.equal(line.toBeScheduled, true);
});

test('public flow: per-group (per_stay) planning option billed quantity × unitPrice (no persons)', () => {
  const q = quote(seedDb(), { selectedOptions: [{ optionId: 7, quantity: 3 }], planningCardAsQuantity: true });
  const line = q.optionLines.find((l) => l.optionId === 7);
  assert.equal(line.billedUnits, 3); // 3 × 1 (per group)
  assert.equal(line.totalPrice, 135); // 3 × 45 €
});

test('public flow: quantity 0 → no line', () => {
  const q = quote(seedDb(), { selectedOptions: [{ optionId: 6, quantity: 0 }], planningCardAsQuantity: true });
  assert.equal(q.optionLines.find((l) => l.optionId === 6), undefined);
});

test('admin flow (flag off): a planning-card option with NO occurrences is still dropped (unchanged)', () => {
  const q = quote(seedDb(), { selectedOptions: [{ optionId: 6, quantity: 2 }] }); // no planningCardAsQuantity, no cardOccurrences
  assert.equal(q.optionLines.find((l) => l.optionId === 6), undefined, 'admin still needs scheduled occurrences');
});

test('admin flow (flag off): a planning-card option WITH occurrences prices by occurrence count', () => {
  const q = quote(seedDb(), { selectedOptions: [{ optionId: 6, quantity: 1, cardOccurrences: [{ date: '2026-07-11', time: '09:00' }, { date: '2026-07-12', time: '09:00' }] }] });
  const line = q.optionLines.find((l) => l.optionId === 6);
  assert.equal(line.billedUnits, 4); // 2 occurrences × 2 persons
  assert.equal(line.totalPrice, 32);
});

// ---- Hourly-scheduled RESOURCES in the public flow (specs/wp-booking-widget-redesign.md §3.10) ----
// The site sells N hours as a bare quantity; the host schedules the sessions later.
// Since specs/hourly-resource-quantity-and-sas-scheduling.md §3.1 rules 1-3 the ADMIN fiche behaves
// the same way — selling by the hour is the default everywhere and `planningCardAsQuantity` no longer
// gates the resource branch. Sessions, when present and valid, still win.

function seedHourlyResource(db) {
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType, showsPlanningCard, propertyIds, hourlyEveningStart, hourlyEveningRate) VALUES (3, 'Bain nordique', 1, 30, 'per_hour', 1, '[1]', '20:00', 50)").run();
  return db;
}

test('public flow: hourly-scheduled resource billed by quantity (= hours) when unscheduled', () => {
  const q = quote(seedHourlyResource(seedDb()), { selectedResources: [{ resourceId: 3, quantity: 2 }], planningCardAsQuantity: true });
  const line = q.resourceLines.find((l) => l.resourceId === 3);
  assert.ok(line, 'the hourly resource is billed from the bare quantity, not dropped');
  assert.equal(line.quantity, 2);
  assert.equal(line.totalPrice, 60); // 2 h × 30 € (day rate)
  assert.equal(q.resourcesTotal, 60);
});

test('public flow: hourly-scheduled resource quantity 0 → no line', () => {
  const q = quote(seedHourlyResource(seedDb()), { selectedResources: [{ resourceId: 3, quantity: 0 }], planningCardAsQuantity: true });
  assert.equal(q.resourceLines.find((l) => l.resourceId === 3), undefined);
});

test('public flow: sessions still win over the bare quantity when provided', () => {
  const q = quote(seedHourlyResource(seedDb()), {
    selectedResources: [{ resourceId: 3, quantity: 5, sessions: [{ date: '2026-07-11', start: '20:00', end: '22:00' }] }],
    planningCardAsQuantity: true,
  });
  const line = q.resourceLines.find((l) => l.resourceId === 3);
  assert.equal(line.totalPrice, 100); // 2 h × 50 € evening grid — not 5 × 30
  assert.equal(line.quantity, 2);     // HOURS scheduled, not the session count (§3.1 rule 7)
});

test('admin flow (flag off): an hourly-scheduled resource with NO sessions is billed by quantity', () => {
  // Regression guard for the reported bug: enabling the Bain nordique on a devis used to return NO
  // line at all, so the resource vanished from the summary and from the total
  // (specs/hourly-resource-quantity-and-sas-scheduling.md §1 defect 1).
  const q = quote(seedHourlyResource(seedDb()), { selectedResources: [{ resourceId: 3, quantity: 2 }] });
  const line = q.resourceLines.find((l) => l.resourceId === 3);
  assert.ok(line, 'an enabled hourly resource must never be dropped from the quote');
  assert.equal(line.quantity, 2);
  assert.equal(line.totalPrice, 60); // 2 h × 30 € day rate — scheduled later, in the arrival SAS
  assert.equal(q.resourcesTotal, 60);
});

test('the resource line no longer depends on planningCardAsQuantity', () => {
  const args = { selectedResources: [{ resourceId: 3, quantity: 2 }] };
  const withFlag = quote(seedHourlyResource(seedDb()), { ...args, planningCardAsQuantity: true });
  const withoutFlag = quote(seedHourlyResource(seedDb()), args);
  assert.deepEqual(
    withFlag.resourceLines.find((l) => l.resourceId === 3),
    withoutFlag.resourceLines.find((l) => l.resourceId === 3),
  );
});
