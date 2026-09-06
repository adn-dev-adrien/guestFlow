const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const Module = require('module');

/**
 * End-to-end regression guard for PROGRESSIVE-PER-PARTICIPANT options on the PUBLIC API
 * (specs/public-api.md). These options carry `priceType = 'per_participant_progressive'`: the
 * quantity sent by the client is the NUMBER OF PARTICIPANTS, and each successive participant is
 * billed at a (usually degressive) tier price.
 *
 * The WordPress booking widget asks the visitor for a participant count and sends it as the option
 * `quantity`; it does NO maths and relies entirely on the public `/quote` total. This test locks
 * that contract by driving the REAL public quote controller through the REAL pricing engine over an
 * in-memory DB, and asserting the public projection's `options[0].total` for several participant
 * counts — mirroring the values verified live on the Gîte (tiers 55 / 45 / 35).
 *
 * Only the applicability lookups and the availability helper are stubbed; pricing is the real thing.
 */

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

// In-memory DB with exactly the tables the pricing engine reads. Seeds one property, one fixed
// nightly rule, and the two progressive options that exist on the real Gîte.
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
      autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT NOT NULL DEFAULT 'fixed', autoFullNightThreshold TEXT
    );
    CREATE TABLE property_options (propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay',
      isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]'
    );
    CREATE TABLE property_resource_prices (propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 20)').run();
  db.prepare(`INSERT INTO properties (id, name) VALUES (1, 'Le Gite')`).run();
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, pricingMode, minNights) VALUES (1, 1, 120, 'fixed', 1)`).run();

  // "Animation enfants + bain nordique": 1->55, 2->100 (55+45), 3->135 (55+45+35), 4->170 (+35).
  db.prepare(`INSERT INTO options (id, title, priceType, price, optionProgressiveTiers) VALUES (15, 'Animation enfants + bain nordique', 'per_participant_progressive', 55, ?)`)
    .run(JSON.stringify([
      { participantNumber: 1, unitPrice: 55 },
      { participantNumber: 2, unitPrice: 45 },
      { participantNumber: 3, unitPrice: 35 },
    ]));
  // "Anim-visite animaux": no tier for participant 1 -> falls back to base price 30. 1->30, 2->60 (30+30), 3->65 (30+30+5).
  db.prepare(`INSERT INTO options (id, title, priceType, price, optionProgressiveTiers) VALUES (11, 'Anim-visite animaux', 'per_participant_progressive', 30, ?)`)
    .run(JSON.stringify([
      { participantNumber: 2, unitPrice: 30 },
      { participantNumber: 3, unitPrice: 5 },
    ]));
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 15)').run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 11)').run();
  return db;
}

// Build the REAL controller (real pricing engine + real validation/projection); stub only the
// applicability lookups and the availability helper. `db` is injected as the in-memory database.
function buildController(db) {
  return withMocks({
    '../../database': db,
    '../../models/optionsModel': {
      listForProperty: () => [{ id: 15 }, { id: 11 }],
      getCancellationInsurance: () => null,
    },
    '../../models/resourcesModel': { list: () => [] },
    './publicCatalogController': { computeBlockedDates: () => [], rangeHasBlockedNight: () => false },
  }, () => {
    const m = '../controllers/public/publicQuoteController';
    delete require.cache[require.resolve(m)];
    return require(m);
  });
}

async function quoteFor(controller, optionId, participants, extra = {}) {
  const res = fakeRes();
  await controller.quote({ body: {
    propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-12',
    adults: 4, children: 0, teens: 0, babies: 0,
    options: [{ optionId, quantity: participants }],
    ...extra,
  } }, res);
  return res;
}

test('public quote prices a progressive option by participant count (degressive tiers 55/45/35)', async () => {
  const controller = buildController(createDb());

  // Mirrors the live Gite checks: the quantity IS the participant count and drives the degressive sum.
  const cases = [
    { participants: 1, total: 55 },
    { participants: 2, total: 100 },
    { participants: 3, total: 135 },
    { participants: 4, total: 170 }, // 4th participant keeps the last tier (35)
  ];
  for (const c of cases) {
    const res = await quoteFor(controller, 15, c.participants);
    assert.equal(res.statusCode, 200, `${c.participants} participants → 200`);
    const line = res.body.data.options.find((o) => o.optionId === 15);
    assert.ok(line, `${c.participants} participants → option line present`);
    assert.equal(line.quantity, c.participants, 'participant count surfaced as the option quantity');
    assert.equal(line.total, c.total, `${c.participants} participants → ${c.total} €`);
    assert.equal(res.body.data.optionsTotal, c.total, 'optionsTotal reflects the degressive line');
  }
});

test('participant 1 falls back to the base price when no tier covers it (30 base, tiers at 2 and 3)', async () => {
  const controller = buildController(createDb());
  // 1 -> 30 (fallback base), 2 -> 60 (30+30), 3 -> 65 (30+30+5).
  for (const c of [{ p: 1, t: 30 }, { p: 2, t: 60 }, { p: 3, t: 65 }]) {
    const res = await quoteFor(controller, 11, c.p);
    assert.equal(res.statusCode, 200);
    const line = res.body.data.options.find((o) => o.optionId === 11);
    assert.equal(line.total, c.t, `${c.p} participants → ${c.t} €`);
  }
});

test('changing the participant count re-prices the option through the public quote (no client-side maths)', async () => {
  const controller = buildController(createDb());
  // The widget refreshes the quote on every +/-; assert two successive counts yield the tiered totals.
  const two = (await quoteFor(controller, 15, 2)).body.data.options.find((o) => o.optionId === 15).total;
  const three = (await quoteFor(controller, 15, 3)).body.data.options.find((o) => o.optionId === 15).total;
  assert.equal(two, 100);
  assert.equal(three, 135);
  assert.notEqual(two, three, 'a different participant count must yield a different total');
});
