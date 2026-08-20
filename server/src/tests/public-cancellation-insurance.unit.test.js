// specs/cancellation-insurance.md §3.3 — what the public API ships to the WordPress widget.
//
// The catalogue half runs on stubbed models (like public-options-grouped.unit.test.js). The quote
// half deliberately does NOT stub the pricing engine or the options model: it wires the REAL engine
// and the REAL model onto an in-memory database, because the one property worth proving is that the
// preview amount shown beside the Oui/Non choice equals the amount actually billed.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/optionsModel');

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// ---------------------------------------------------------------- catalogue

function listOptions(options, offeredDefaultIds = []) {
  const controller = withMocks({
    '../../database': { prepare: () => ({ get: () => ({ 1: 1 }), all: () => offeredDefaultIds.map((id) => ({ optionId: id })) }) },
    '../../models/optionsModel': { listForProperty: () => options },
    '../../models/resourcesModel': { list: () => [] },
  }, () => {
    const m = '../controllers/public/publicCatalogController';
    delete require.cache[require.resolve(m)];
    return require(m);
  });
  const res = fakeRes();
  controller.listOptions({ params: { id: '1' } }, res);
  assert.equal(res.statusCode, 200);
  return res.body.data;
}

const INSURANCE = {
  id: 42, title: 'Assurance annulation', description: 'Garantie annulation.',
  priceType: 'percent_of_stay', price: 4, isCancellationInsurance: 1,
};

test('the insurance leaves the supplements lists and gets its own block', () => {
  const data = listOptions([
    { id: 1, title: 'Ménage', priceType: 'per_stay', price: 80 },
    { id: 2, title: 'Planche S', priceType: 'per_stay', price: 17, category: 'Restauration' },
    INSURANCE,
  ]);
  assert.deepEqual(data.ungrouped.map((o) => o.title), ['Ménage'], 'never one row among the extras');
  assert.deepEqual(data.groups.flatMap((g) => g.options.map((o) => o.title)), ['Planche S']);
  assert.equal(data.cancellationInsurance.optionId, 42);
  assert.equal(data.cancellationInsurance.percent, 4);
  assert.equal(data.cancellationInsurance.priceLabel, '4 % du montant du séjour');
  assert.equal(data.cancellationInsurance.amount, null, 'no stay yet → no amount, the label stands in');
});

test('an unpriced insurance is not an offer — no block, so nothing to answer', () => {
  const data = listOptions([{ ...INSURANCE, price: 0 }]);
  assert.equal(data.cancellationInsurance, null);
  assert.deepEqual(data.ungrouped, []);
});

test('no insurance configured at all → null', () => {
  const data = listOptions([{ id: 1, title: 'Ménage', priceType: 'per_stay', price: 80 }]);
  assert.equal(data.cancellationInsurance, null);
});

test('an insurance hidden from clients or offered by default is not sold', () => {
  assert.equal(listOptions([{ ...INSURANCE, displayToClient: 0 }]).cancellationInsurance, null);
  assert.equal(listOptions([INSURANCE], [42]).cancellationInsurance, null);
});

test('a flat-price insurance gets a euro label instead of a percentage', () => {
  const data = listOptions([{ ...INSURANCE, priceType: 'per_stay', price: 25 }]);
  assert.equal(data.cancellationInsurance.priceLabel, '25 € au séjour');
  assert.equal(data.cancellationInsurance.percent, null);
});

// -------------------------------------------------------------------- quote

function quoteDb({ percent = 4 } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay');
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 100,
      pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]',
      color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1, maxNights INTEGER);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, titleEn TEXT DEFAULT '', description TEXT,
      priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]',
      autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed',
      autoFullNightThreshold TEXT, showsPlanningCard INTEGER DEFAULT 0, cardRepeat TEXT,
      displayToClient INTEGER DEFAULT 1, isCancellationInsurance INTEGER DEFAULT 0);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL DEFAULT 0,
      PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE resource_properties (propertyId INTEGER, resourceId INTEGER, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura Lodge')").run();
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges)
    VALUES (1, 1, 100, '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]')`).run();
  if (percent > 0) {
    db.prepare(`INSERT INTO options (id, title, description, priceType, price, isCancellationInsurance)
      VALUES (42, 'Assurance annulation', 'Garantie annulation.', 'percent_of_stay', ?, 1)`).run(percent);
    db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 42)').run();
  }
  return db;
}

function publicQuote(db, body) {
  const controller = withMocks({
    '../../database': db,
    '../../models/optionsModel': buildModel(db),
    '../../models/resourcesModel': { list: () => [] },
    '../../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    './publicCatalogController': { computeBlockedDates: () => [], rangeHasBlockedNight: () => false },
  }, () => {
    const m = '../controllers/public/publicQuoteController';
    delete require.cache[require.resolve(m)];
    return require(m);
  });
  const res = fakeRes();
  controller.quote({ body }, res);
  return res;
}

const STAY = {
  propertyId: 1, startDate: '2026-05-01', endDate: '2026-05-04', // 3 nights × 100 €
  adults: 2, children: 0, teens: 0, babies: 0,
};

test('the quote prices the insurance even when the visitor has not taken it', () => {
  const db = quoteDb();
  const res = publicQuote(db, { ...STAY, options: [] });
  assert.equal(res.statusCode, 200);
  const ins = res.body.data.cancellationInsurance;
  assert.equal(ins.amount, 12, '4 % of the 300 € stay, shown beside the Oui/Non choice');
  assert.equal(ins.selected, false);
  assert.equal(res.body.data.optionsTotal, 0, 'a preview is not a sale');
  db.close();
});

test('the previewed amount is the billed amount — they cannot diverge', () => {
  const db = quoteDb();
  const preview = publicQuote(db, { ...STAY, options: [] }).body.data.cancellationInsurance;
  const taken = publicQuote(db, { ...STAY, options: [{ optionId: 42, quantity: 1 }] }).body.data;
  assert.equal(taken.cancellationInsurance.selected, true);
  assert.equal(taken.cancellationInsurance.amount, preview.amount);
  assert.equal(taken.options.find((o) => o.optionId === 42).total, preview.amount);
  assert.equal(taken.optionsTotal, 12);
  assert.equal(taken.totalStayPrice, 312);
  db.close();
});

test('the premium follows the stay — a longer stay costs more to insure', () => {
  const db = quoteDb();
  const week = publicQuote(db, { ...STAY, endDate: '2026-05-08', options: [] }).body.data;
  assert.equal(week.cancellationInsurance.amount, 28, '4 % of 7 nights × 100 €');
  db.close();
});

test('no insurance configured → no block in the quote either', () => {
  const db = quoteDb({ percent: 0 });
  const res = publicQuote(db, { ...STAY, options: [] });
  assert.equal(res.body.data.cancellationInsurance, null);
  db.close();
});

// The default tariff is per-night (specs/cancellation-insurance.md §3.2 rule 13): the site must
// announce « 3 € par nuit » and preview the same amount the engine will bill.

test('a per-night insurance is announced by the night', () => {
  const data = listOptions([{ ...INSURANCE, priceType: 'per_night', price: 3 }]);
  assert.equal(data.cancellationInsurance.priceLabel, '3 € par nuit');
  assert.equal(data.cancellationInsurance.percent, null);
  assert.equal(data.cancellationInsurance.amount, null, 'no stay yet → the label stands in');
});

test('a per-night insurance previews and bills the same nights', () => {
  const db = quoteDb();
  db.prepare("UPDATE options SET priceType = 'per_night', price = 3 WHERE id = 42").run();
  const preview = publicQuote(db, { ...STAY, options: [] }).body.data.cancellationInsurance;
  assert.equal(preview.amount, 9, '3 € × the 3 nights');
  const taken = publicQuote(db, { ...STAY, options: [{ optionId: 42, quantity: 1 }] }).body.data;
  assert.equal(taken.cancellationInsurance.amount, 9);
  assert.equal(taken.optionsTotal, 9);
  assert.equal(taken.totalStayPrice, 309);
  db.close();
});

test('a visitor cannot inflate a per-night insurance with a quantity', () => {
  const db = quoteDb();
  db.prepare("UPDATE options SET priceType = 'per_night', price = 3 WHERE id = 42").run();
  const taken = publicQuote(db, { ...STAY, options: [{ optionId: 42, quantity: 9 }] }).body.data;
  assert.equal(taken.optionsTotal, 9, 'the engine clamps the yes/no line to the stay');
  db.close();
});
