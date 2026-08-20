/**
 * specs/payment-link-quote-parity.md — the Qonto payment link must ask for the amount the devis shows.
 *
 * `paymentsController` resolved its amounts from a hand-rolled engine input built in the controller,
 * instead of the authoritative replay `devisModel.recomputeQuote` that the devis screen and the PDF
 * read (specs/devis-pdf-total-parity.md §3.1). That input dropped the scheduled moments of a
 * planning-card option, the sessions of an hourly resource, the offered lines and the price lock — so
 * the guest was invoiced less (or more) than the quote they accepted.
 *
 * Part A — the resolvers now read the same replay as the devis (rules 1-4).
 * Part B — REGRESSION: the input the controller used to build, kept as an executable description of
 *          the bug (rule 2).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');
const { calculateReservationQuote } = require('../utils/pricing');
const { __test: { resolveAmountCents, resolveVatComponents } } = require('../controllers/paymentsController');

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
    showsPlanningCard INTEGER NOT NULL DEFAULT 0, cardRepeat TEXT DEFAULT 'once_per_day',
    planningCardTimes TEXT, displayToClient INTEGER NOT NULL DEFAULT 1
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
const MEAL = 2;       // planning-card option, 25 €/pers./moment — the one that used to vanish
const BED_LINEN = 3;  // property default « offerte » → 0 €

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  let serial = 0;
  db.generateDevisNumber = () => `D-PAYLINK-${++serial}`;
  db.prepare(`INSERT INTO properties (id, name, touristTaxPerDayPerPerson) VALUES (1, 'Gîte', 1)`).run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare(`INSERT INTO options (id, title, priceType, price) VALUES (${CLEANING}, 'Ménage', 'per_stay', 80)`).run();
  db.prepare(`INSERT INTO options (id, title, priceType, price, showsPlanningCard, cardRepeat, planningCardTimes)
    VALUES (${MEAL}, 'Le repas des trappeurs', 'per_person_per_night', 25, 1, 'multiple_per_day', '["19:30"]')`).run();
  db.prepare(`INSERT INTO options (id, title, priceType, price) VALUES (${BED_LINEN}, 'Linge de lit', 'per_stay', 60)`).run();
  for (const id of [CLEANING, MEAL, BED_LINEN]) {
    db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(id);
  }
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, ?, 1)').run(BED_LINEN);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return { model: devisModel.buildModel(db), db };
}

// Far-future stay so the quote stays valid (validUntil is driven by quoteValidityDays).
const MOMENTS = [{ date: '2030-07-11', time: '19:30' }];
const BASE = {
  propertyId: 1, clientId: 1,
  startDate: '2030-07-10', endDate: '2030-07-13',
  adults: 2, children: 0, platform: 'direct',
  selectedOptions: [
    { optionId: CLEANING, quantity: 1 },
    { optionId: MEAL, quantity: 1, cardOccurrences: MOMENTS },
  ],
};

// The controller's real resolvers, driven on the in-memory devis instead of the production database.
const quoteOf = (model) => (id) => model.recomputeQuote(id);
const cents = (euros) => Math.round(Number(euros) * 100);

// ── Part A — the payment link asks for what the devis shows ──────────────────────────────────

test('a devis carrying a scheduled card option: acompte, solde and total match the quote', () => {
  const { model } = freshModel();
  const devis = model.create(BASE).data;

  // 3 × 100 + 80 (ménage) + 1 moment × 2 pers. × 25 (repas) = 430
  assert.equal(devis.finalPrice, 430);
  const meal = devis.options.find((o) => Number(o.optionId) === MEAL);
  assert.equal(meal.totalPrice, 50, 'the meal IS on the devis the guest accepted');

  const row = { depositAmount: devis.depositAmount, balanceAmount: devis.balanceAmount, finalPrice: devis.finalPrice };
  assert.equal(resolveAmountCents(devis.id, 'full', row, quoteOf(model)), cents(devis.finalPrice));
  assert.equal(resolveAmountCents(devis.id, 'deposit', row, quoteOf(model)), cents(devis.depositAmount));
  assert.equal(resolveAmountCents(devis.id, 'balance', row, quoteOf(model)), cents(devis.balanceAmount));
});

// ── The acompte/solde split: one rule, from the engine (specs/tourist-tax-on-solde.md rule 1) ──

test('the devis screen shows the engine split: acompte on the accommodation, tax on the solde', () => {
  const { model } = freshModel();
  const devis = model.create(BASE).data;
  const quote = model.recomputeQuote(devis.id);

  // 30 % of the accommodation (430), NOT of the tax-inclusive total (436) — the devis used to
  // display 130,80 € while its own stored row, the guest's email and the Qonto page said 129,00 €.
  assert.equal(devis.depositAmount, 129);
  assert.equal(devis.balanceAmount, 307, 'the whole 6 € of tourist tax rides on the solde');
  assert.equal(devis.totalStayPrice, 436, 'the displayed stay total stays tax-inclusive');
  assert.equal(devis.depositAmount, quote.depositAmount, 'devis screen == engine == payment link');
  assert.equal(devis.balanceAmount, quote.balanceAmount);
});

test('a devis with no acompte keeps 0 — it is never re-derived to a percentage', () => {
  const { model, db } = freshModel();
  const devis = model.create(BASE).data;
  db.prepare('UPDATE reservations SET depositAmount = 0, balanceAmount = ? WHERE id = ?')
    .run(436, devis.id);

  const reread = model.findById(devis.id);
  assert.equal(reread.depositAmount, 0, 'a last-minute stay owes everything on the solde');
  assert.equal(reread.balanceAmount, 436);
});

test('a legacy row with no stored split at all falls back to the historic derivation', () => {
  const { model, db } = freshModel();
  const devis = model.create(BASE).data;
  db.prepare('UPDATE reservations SET depositAmount = NULL, balanceAmount = NULL WHERE id = ?').run(devis.id);

  const reread = model.findById(devis.id);
  assert.equal(reread.depositAmount, 130.8, '30 % of the tax-inclusive total, as before');
  assert.equal(reread.balanceAmount, 305.2);
});

test('an offered option is not re-billed by the payment link', () => {
  const { model } = freshModel();
  const devis = model.create(BASE).data;   // the linen rides in as a property default, « offerte »
  const linen = devis.options.find((o) => Number(o.optionId) === BED_LINEN);
  assert.ok(linen, 'the property default is on the devis');
  assert.equal(linen.totalPrice, 0, 'offered → 0 €');

  const row = { finalPrice: devis.finalPrice };
  assert.equal(resolveAmountCents(devis.id, 'full', row, quoteOf(model)), cents(430), 'not 430 + 60');
});

test('price lock: a tariff rise after the devis was issued never reaches the payment page', () => {
  const { model, db } = freshModel();
  const devis = model.create(BASE).data;
  db.prepare('UPDATE pricing_rules SET pricePerNight = 200 WHERE propertyId = 1').run();
  db.prepare('UPDATE options SET price = price * 2').run();

  const row = { finalPrice: devis.finalPrice, depositAmount: devis.depositAmount };
  assert.equal(resolveAmountCents(devis.id, 'full', row, quoteOf(model)), cents(430), 'the guest owes what was quoted');
});

test('the VAT basket is built from the same quote (tourist tax on the solde, 0 %)', () => {
  const { model } = freshModel();
  const devis = model.create(BASE).data;

  const full = resolveVatComponents(devis.id, 'full', quoteOf(model));
  assert.equal(full.components.length, 1);
  assert.equal(full.components[0].grossCents, cents(devis.finalPrice));

  const balance = resolveVatComponents(devis.id, 'balance', quoteOf(model));
  const taxLine = balance.components.find((c) => c.title === 'Taxe de séjour');
  assert.ok(taxLine, 'the tourist tax rides on the solde');
  assert.equal(taxLine.taxable, false);
  assert.equal(
    balance.components.reduce((s, c) => s + c.grossCents, 0),
    cents(devis.balanceAmount),
    'the basket sums to the charged amount',
  );
});

test('a reservation (no devis replay) keeps the stored column', () => {
  const { model } = freshModel();
  const row = { depositAmount: 123.45 };
  // `recomputeQuote` returns null for anything that is not a devis — the fallback must hold.
  assert.equal(resolveAmountCents(999, 'deposit', row, quoteOf(model)), 12345);
  assert.equal(resolveVatComponents(999, 'deposit', quoteOf(model)), null);
});

// ── Part B — REGRESSION: what the controller used to build ───────────────────────────────────

test('REGRESSION: an engine input without the scheduled moments loses the meal entirely', () => {
  const { model, db } = freshModel();
  const devis = model.create(BASE).data;

  // The mapping paymentsController built inline: no cardOccurrences, no offered set, no price lock.
  const naive = calculateReservationQuote({
    db,
    kind: 'devis',
    validUntil: devis.validUntil || null,
    propertyId: 1,
    startDate: devis.startDate, endDate: devis.endDate,
    checkInTime: devis.checkInTime, checkOutTime: devis.checkOutTime,
    adults: 2, children: 0, teens: 0, babies: 0,
    selectedOptions: (devis.options || []).filter((o) => !o.isCustom).map((o) => ({
      optionId: Number(o.optionId), quantity: Number(o.quantity || 1),
      unitPrice: o.unitPrice != null ? Number(o.unitPrice) : undefined,
    })),
    customOptions: [], selectedResources: [], platform: devis.platform,
  });

  assert.equal(naive.optionLines.filter((l) => Number(l.optionId) === MEAL).length, 0,
    'the engine reads a card option with no moment as « not taken » — the meal simply vanishes');
  // The same input also re-bills the offered linen (no `offeredOptionIds`), so the total is wrong in
  // BOTH directions at once — it matches nothing the guest ever saw.
  assert.notEqual(naive.finalPrice, devis.finalPrice);
  assert.equal(naive.optionLines.find((l) => Number(l.optionId) === BED_LINEN).totalPrice, 60,
    'the offered linen comes back at full price');
  // …and the replay the controller now uses charges exactly the accepted quote.
  const replay = model.recomputeQuote(devis.id);
  assert.equal(replay.finalPrice, 430);
  assert.equal(replay.optionLines.find((l) => Number(l.optionId) === MEAL).totalPrice, 50);
});
