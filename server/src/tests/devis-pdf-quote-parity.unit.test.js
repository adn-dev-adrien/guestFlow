/**
 * specs/devis-pdf-total-parity.md — the devis PDF must print the amounts the operator validated.
 *
 * The PDF draws its table from the PERSISTED devis but resolves its tourist tax + TOTAL from a live
 * re-quote. The re-quote therefore has to replay the state the devis was SOLD under; when it didn't,
 * the printed total matched nothing on the page (user report 2026-08-17: « Sous-total TTC 523,92 »
 * followed by « TOTAL TTC 595,00 », tourist tax 11,08 instead of 9,60).
 *
 * Part A — `devisModel.recomputeQuote` reproduces the stored devis (rules 1-4).
 * Part B — the PDF-side guard: whatever the re-quote says, the total is the printed lines + the
 *          printed tax (rules 6-9).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');
const { calculateReservationQuote } = require('../utils/pricing');
const { __test: { resolveLiveTaxTotals } } = require('../utils/devisPdf');

const DDL = `
  CREATE TABLE properties (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL,
    depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
    defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00', defaultCautionAmount REAL DEFAULT 500,
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
    showsPlanningCard INTEGER NOT NULL DEFAULT 0, displayToClient INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE property_options ( propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId) );
  CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
  CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    devisNumber TEXT, devisStatus TEXT, validUntil TEXT, convertedReservationId INTEGER, pdfLanguage TEXT DEFAULT 'fr',
    requestOrigin TEXT, publicToken TEXT,
    propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT,
    adults INTEGER DEFAULT 1, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER, checkInTime TEXT, checkOutTime TEXT, platform TEXT,
    breakfastTime TEXT, extraGuestSurchargeOffered INTEGER DEFAULT 0, touristTaxInComplement INTEGER DEFAULT 0, tariffSnapshot TEXT,
    totalPrice REAL DEFAULT 0, touristTaxRate REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0, discountPercent REAL DEFAULT 0,
    customPrice REAL, finalPrice REAL DEFAULT 0, depositAmount REAL DEFAULT 0, depositDueDate TEXT, depositPaid INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0, balanceDueDate TEXT, balancePaid INTEGER DEFAULT 0, cautionAmount REAL DEFAULT 0, notes TEXT, sourceType TEXT,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE reservation_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL,
    billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0,
    inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, cardOccurrences TEXT
  );
  CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL);
  CREATE TABLE reservation_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, sessions TEXT);
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT, createdAt TEXT DEFAULT (datetime('now')));
  CREATE TABLE property_option_defaults (propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, offered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, quoteValidityDays INTEGER NOT NULL DEFAULT 30, vatRate REAL NOT NULL DEFAULT 10);
  INSERT INTO app_settings (id, quoteValidityDays, vatRate) VALUES (1, 30, 10);
`;

const CLEANING = 1;   // billed, 80 €
const BED_LINEN = 2;  // property default « offerte » → 0 € + tourist-tax deduction
const BREAKFAST = 3;  // planning-card option
const EARLY_IN = 4;   // engine-managed auto-option

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  let serial = 0;
  db.generateDevisNumber = () => `D-PARITY-${++serial}`;
  // Percentage-based tourist tax + department surcharge: the mode where losing the « comprise dans
  // le tarif » deduction visibly moves the tax (the user's property is configured this way).
  db.prepare(`INSERT INTO properties (id, name, touristTaxMode, touristTaxPercentage, touristTaxDepartmentPercentage)
    VALUES (1, 'Aventura Lodge', 'percentage_accommodation', 5, 10)`).run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare(`INSERT INTO options (id, title, priceType, price) VALUES (${CLEANING}, 'Ménage', 'per_stay', 80)`).run();
  db.prepare(`INSERT INTO options (id, title, priceType, price) VALUES (${BED_LINEN}, 'Linge de lit', 'per_stay', 60)`).run();
  db.prepare(`INSERT INTO options (id, title, priceType, price, showsPlanningCard) VALUES (${BREAKFAST}, 'Petit-déjeuner', 'per_stay', 12, 1)`).run();
  db.prepare(`INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled, autoPricingMode)
    VALUES (${EARLY_IN}, 'Arrivée anticipée', 'per_stay', 30, 'early_check_in', 1, 'fixed')`).run();
  for (const id of [CLEANING, BED_LINEN, BREAKFAST, EARLY_IN]) {
    db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(id);
  }
  // The « Linge de lit » is a property default configured OFFERED → included in the night rate.
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, ?, 1)').run(BED_LINEN);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return { model: devisModel.buildModel(db), db };
}

// Far-future stay so the quote stays valid (validUntil is driven by quoteValidityDays).
const BASE = {
  propertyId: 1, clientId: 1,
  startDate: '2030-07-10', endDate: '2030-07-13',
  adults: 2, children: 2, platform: 'direct',
  selectedOptions: [{ optionId: CLEANING, quantity: 1 }],
};

function raiseTariffs(db) {
  db.prepare('UPDATE pricing_rules SET pricePerNight = 200 WHERE propertyId = 1').run();
  db.prepare('UPDATE options SET price = price * 2').run();
}

// The sum of the rows the PDF draws = the persisted accommodation + option + resource lines.
function printedRowsTtc(devis) {
  const nights = (devis.nights || []).reduce((sum, night) => sum + Number(night.price || 0), 0);
  const options = (devis.options || []).reduce((sum, line) => sum + Number(line.totalPrice || 0), 0);
  const resources = (devis.resources || []).reduce((sum, line) => sum + Number(line.totalPrice || 0), 0);
  return Math.round((nights + options + resources) * 100) / 100;
}

// ── Part A — the replay reproduces the sold devis ──────────────────────────────────────

test('offered property-default option: the replay keeps it at 0 € AND re-quotes the same tax', () => {
  const { model } = freshModel();
  const devis = model.create(BASE).data;

  // 3 × 100 + 80 (ménage) + 0 (linge offert, comprise dans le tarif)
  assert.equal(devis.finalPrice, 380);
  const storedLinen = devis.options.find((o) => Number(o.optionId) === BED_LINEN);
  assert.equal(storedLinen.totalPrice, 0);
  assert.equal(Number(storedLinen.offered), 1);

  const quote = model.recomputeQuote(devis.id);
  assert.equal(quote.finalPrice, devis.finalPrice, 'the PDF must re-quote the stay it prints');
  assert.equal(quote.touristTaxTotal, devis.touristTaxTotal, 'and the tax the devis was saved with');
  const replayedLinen = quote.optionLines.find((l) => Number(l.optionId) === BED_LINEN);
  assert.equal(replayedLinen.totalPrice, 0);
  assert.equal(replayedLinen.includedInRate, true);
});

test('REGRESSION: an input that drops offeredOptionIds re-bills the option', () => {
  // What the PDF controller used to build. Kept as an executable description of the bug: the offered
  // 60 € comes back into the total. The tourist tax no longer reacts to it at all — the base is the
  // accommodation and nothing else (specs/tourist-tax-base-accommodation-only.md).
  const { model, db } = freshModel();
  const devis = model.create(BASE).data;
  const naive = calculateReservationQuote({
    db, propertyId: 1,
    startDate: devis.startDate, endDate: devis.endDate,
    checkInTime: devis.checkInTime, checkOutTime: devis.checkOutTime,
    adults: devis.adults, children: devis.children, teens: devis.teens, babies: devis.babies,
    selectedOptions: devis.options.filter((o) => !o.isCustom).map((o) => ({ optionId: Number(o.optionId), quantity: Number(o.quantity || 1) })),
    customOptions: [], selectedResources: [], platform: devis.platform,
  });

  assert.equal(naive.finalPrice, devis.finalPrice + 60);
  assert.equal(naive.touristTaxTotal, devis.touristTaxTotal);
  // …and the fixed replay does neither.
  assert.equal(model.recomputeQuote(devis.id).finalPrice, devis.finalPrice);
});

test('price lock: a tariff rise after the devis was issued does not reach the PDF (rule 3)', () => {
  const { model, db } = freshModel();
  const devis = model.create(BASE).data;
  raiseTariffs(db);

  const quote = model.recomputeQuote(devis.id);
  assert.equal(quote.finalPrice, 380, 'the guest was quoted 380 € — the PDF still says 380 €');
  assert.equal(quote.touristTaxTotal, devis.touristTaxTotal);
});

test('engine-managed auto-option: the replay does not double-count the persisted line', () => {
  const { model } = freshModel();
  const devis = model.create({ ...BASE, checkInTime: '12:00' }).data;
  const early = devis.options.find((o) => Number(o.optionId) === EARLY_IN);
  assert.ok(early && Number(early.totalPrice) > 0, 'the early check-in was auto-added and persisted');

  const quote = model.recomputeQuote(devis.id);
  assert.equal(quote.finalPrice, devis.finalPrice);
  assert.equal(quote.optionLines.filter((l) => Number(l.optionId) === EARLY_IN).length, 1);
});

test('public devis: the planning-card option keeps its quantity-based price in the replay', () => {
  const { model, db } = freshModel();
  const devis = model.create({
    ...BASE,
    selectedOptions: [{ optionId: BREAKFAST, quantity: 2 }],
    planningCardAsQuantity: true,
  }).data;
  db.prepare("UPDATE reservations SET requestOrigin = 'public' WHERE id = ?").run(devis.id);

  assert.equal(devis.finalPrice, 324); // 3 × 100 + 2 × 12
  // Without `planningCardAsQuantity` the engine treats an unscheduled card option as « not taken »
  // and the line vanishes — the PDF would print a total 24 € below its own lines.
  assert.equal(model.recomputeQuote(devis.id).finalPrice, 324);
});

test('unknown devis → null (the PDF falls back to the stored row instead of throwing)', () => {
  const { model } = freshModel();
  assert.equal(model.recomputeQuote(999999), null);
});

// ── Part B — the PDF guard: the total is the printed lines + the printed tax ───────────

test('end to end: PDF totals equal the persisted devis, so PDF == devis screen', () => {
  const { model } = freshModel();
  const devis = model.create(BASE).data;
  const quote = model.recomputeQuote(devis.id);

  const rows = printedRowsTtc(devis);
  const out = resolveLiveTaxTotals(devis, quote, rows);
  assert.equal(out.quoteReconciles, true);
  assert.equal(out.liveTaxTotal, devis.touristTaxTotal);
  assert.equal(out.grandTotalTtc, Math.round((devis.finalPrice + devis.touristTaxTotal) * 100) / 100);
});

test('expired devis: the PDF prints the prices it was sold at, not today’s tariffs (rule 11)', () => {
  const { model, db } = freshModel();
  const devis = model.create(BASE).data;
  raiseTariffs(db);
  db.prepare("UPDATE reservations SET validUntil = '2020-01-01' WHERE id = ?").run(devis.id);

  // Once expired the replay legitimately unlocks and re-prices (rule 14 of the price-lock spec)…
  const stale = model.findById(devis.id);
  const quote = model.recomputeQuote(devis.id);
  assert.ok(quote.finalPrice > stale.finalPrice);

  // …but the document still prints its own lines, so the guard discards that re-quote.
  const out = resolveLiveTaxTotals(stale, quote, printedRowsTtc(stale));
  assert.equal(out.quoteReconciles, false);
  assert.equal(out.liveTaxTotal, stale.touristTaxTotal);
  assert.equal(out.grandTotalTtc, Math.round((stale.finalPrice + stale.touristTaxTotal) * 100) / 100);
});
