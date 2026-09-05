/**
 * specs/neat-cancellation-insurance-subscription.md §3.2 rule 13 — utils/neatGuestPricing.js.
 *
 * Guest price = ceil(premium × (1 + margin/100)); resolution ladder fresh cache → live → stale
 * cache → null; the engine override prices the flagged insurance stay-wide; a sold line stays
 * frozen; the public projection announces the per-stay label.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  computeGuestPrice, resolveInsurancePricing, resolveInsurancePricingSync,
  repriceQuoteWithNeatSync, CACHE_FRESH_MS,
} = require('../utils/neatGuestPricing');
const { calculateReservationQuote } = require('../utils/pricing');
const { toPublicCancellationInsurance } = require('../utils/publicProjections');

// ---- fakes ----

const CONTRACT_FIELDS = [{ id: 'f-nights', title: 'Nuits', name: 'nights', type: 'number', required: true, options: [] }];
const MAPPING = { 'f-nights': { source: 'nights' } };

function fakeSettings(overrides = {}) {
  return {
    neatConfig: () => ({
      environment: 'staging', clientId: 'id', clientSecret: 'secret',
      storeId: '', salesChannelId: 'ch-1', salesChannelLabel: '', contractId: 'c-1', contractLabel: '',
      paymentMethodId: 'pm-1', paymentMethodKind: 'Cash', paymentMethodLabel: '',
      fieldMappingJson: JSON.stringify(MAPPING),
      contractFieldsJson: JSON.stringify(CONTRACT_FIELDS),
      marginPercent: 30,
      ...overrides,
    }),
  };
}

function fakeCache(initial = null) {
  let row = initial;
  return {
    stored: [],
    getCachedPremium: () => row,
    storePremium(env, contractId, hash, premium, fetchedAt) {
      row = { premium, fetchedAt };
      this.stored.push({ env, contractId, hash, premium, fetchedAt });
    },
  };
}

const clientPricing = (amount) => () => ({ price: async () => ({ amount }) });
const clientDown = () => ({ price: async () => { throw new Error('Neat down'); } });
const silentLogger = { warn: () => {}, log: () => {}, error: () => {} };

const SNAPSHOT = { startDate: '2026-10-01', endDate: '2026-10-08', nights: 7, guests: 2, accommodationAmount: 700, totalAmount: 700, propertyName: 'Lodge', reservationRef: '' };

// ---- the euro ceil ----

test('computeGuestPrice ceils to the whole euro: 17,50 € + 30 % = 22,75 → 23 €', () => {
  assert.equal(computeGuestPrice(17.5, 30), 23);
  assert.equal(computeGuestPrice(17.5, 0), 18, 'a 0 % margin still ceils');
  assert.equal(computeGuestPrice(20, 0), 20, 'an exact-euro premium is not inflated');
  assert.equal(computeGuestPrice(20, 10), 22);
  assert.equal(computeGuestPrice(0, 30), 0, 'a free premium yields a free line');
  assert.equal(computeGuestPrice(-1, 30), null, 'a negative premium never credits the guest');
  assert.equal(computeGuestPrice(17.5, null), null, 'no margin → Neat pricing inactive');
});

// ---- the resolution ladder ----

test('a fresh cache serves without touching Neat', async () => {
  const cache = fakeCache({ premium: 17.5, fetchedAt: new Date().toISOString() });
  let called = false;
  const out = await resolveInsurancePricing({
    settingsModel: fakeSettings(), cacheModel: cache,
    buildClient: () => ({ price: async () => { called = true; return { amount: 99 }; } }),
    logger: silentLogger,
  }, SNAPSHOT);
  assert.deepEqual({ unitPrice: out.unitPrice, premium: out.premium, source: out.source }, { unitPrice: 23, premium: 17.5, source: 'cache' });
  assert.equal(called, false);
});

test('a cold cache prices live and warms the cache', async () => {
  const cache = fakeCache(null);
  const out = await resolveInsurancePricing({
    settingsModel: fakeSettings(), cacheModel: cache, buildClient: clientPricing(17.5), logger: silentLogger,
  }, SNAPSHOT);
  assert.equal(out.source, 'live');
  assert.equal(out.unitPrice, 23);
  assert.equal(cache.stored.length, 1);
  assert.equal(cache.stored[0].premium, 17.5);
});

test('a stale cache is refreshed live; when Neat is down it still serves', async () => {
  const staleAt = new Date(Date.now() - CACHE_FRESH_MS - 60000).toISOString();
  const refreshed = await resolveInsurancePricing({
    settingsModel: fakeSettings(), cacheModel: fakeCache({ premium: 10, fetchedAt: staleAt }),
    buildClient: clientPricing(17.5), logger: silentLogger,
  }, SNAPSHOT);
  assert.equal(refreshed.source, 'live');
  assert.equal(refreshed.premium, 17.5);

  const served = await resolveInsurancePricing({
    settingsModel: fakeSettings(), cacheModel: fakeCache({ premium: 10, fetchedAt: staleAt }),
    buildClient: clientDown, logger: silentLogger,
  }, SNAPSHOT);
  assert.equal(served.source, 'stale-cache');
  assert.equal(served.unitPrice, 13, 'ceil(10 × 1.3)');
});

test('Neat down + cold cache → null (the static tariff applies), never a throw', async () => {
  const out = await resolveInsurancePricing({
    settingsModel: fakeSettings(), cacheModel: fakeCache(null), buildClient: clientDown, logger: silentLogger,
  }, SNAPSHOT);
  assert.equal(out, null);
});

test('an incomplete configuration is inactive: no margin, no mapping, no contract fields, no secret', async () => {
  for (const overrides of [
    { marginPercent: null },
    { fieldMappingJson: '' },
    { contractFieldsJson: '' },
    { clientSecret: '' },
  ]) {
    const out = await resolveInsurancePricing({
      settingsModel: fakeSettings(overrides), cacheModel: fakeCache(null), buildClient: clientPricing(17.5), logger: silentLogger,
    }, SNAPSHOT);
    assert.equal(out, null, JSON.stringify(overrides));
  }
});

test('the sync resolver is cache-only: warm (even stale) serves, cold yields null', () => {
  const staleAt = new Date(Date.now() - CACHE_FRESH_MS - 60000).toISOString();
  const warm = resolveInsurancePricingSync({ settingsModel: fakeSettings(), cacheModel: fakeCache({ premium: 17.5, fetchedAt: staleAt }) }, SNAPSHOT);
  assert.equal(warm.unitPrice, 23);
  const cold = resolveInsurancePricingSync({ settingsModel: fakeSettings(), cacheModel: fakeCache(null) }, SNAPSHOT);
  assert.equal(cold, null);
});

// ---- the engine override, through a real engine run ----

function engineDb() {
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
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT,
      showsPlanningCard INTEGER DEFAULT 0, cardRepeat TEXT, isCancellationInsurance INTEGER DEFAULT 0);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL DEFAULT 0,
      freeUnits REAL NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE resource_properties (propertyId INTEGER, resourceId INTEGER, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura Lodge')").run();
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges)
    VALUES (1, 1, 100, '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]')`).run();
  // A per-night insurance at 3 €/night — the STATIC tariff the override must beat.
  db.prepare(`INSERT INTO options (id, title, priceType, price, isCancellationInsurance)
    VALUES (10, 'Assurance annulation', 'per_night', 3, 1)`).run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  return db;
}

const STAY = {
  propertyId: 1, adults: 2, children: 0, teens: 0, babies: 0,
  checkInTime: '16:00', checkOutTime: '10:00',
  startDate: '2026-05-01', endDate: '2026-05-04', // 3 nights × 100 €
  customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  selectedOptions: [{ optionId: 10, quantity: 1 }],
};
const insurance = (q) => q.optionLines.find((l) => l.optionId === 10);

test('the override prices the flagged insurance stay-wide: unit = ceil(premium+margin), billedUnits = 1', () => {
  const db = engineDb();
  const q = calculateReservationQuote({ ...STAY, db, cancellationInsurancePriceOverride: 23 });
  const line = insurance(q);
  assert.equal(line.unitPrice, 23);
  assert.equal(line.billedUnits, 1, 'never × nights — the Neat premium covers the whole stay');
  assert.equal(line.totalPrice, 23);
  db.close();
});

test('without the override the static per-night tariff applies exactly as before', () => {
  const db = engineDb();
  const line = insurance(calculateReservationQuote({ ...STAY, db }));
  assert.equal(line.unitPrice, 3);
  assert.equal(line.billedUnits, 3);
  assert.equal(line.totalPrice, 9);
  db.close();
});

test('a SOLD insurance line stays frozen whole — even when the override disappears later', () => {
  const db = engineDb();
  const locked = [{ optionId: 10, quantity: 1, unitPrice: 23, billedUnits: 1, priceType: 'per_night', totalPrice: 23, offered: 0 }];
  const withOverride = insurance(calculateReservationQuote({ ...STAY, db, lockedOptionLines: locked, cancellationInsurancePriceOverride: 25 }));
  assert.equal(withOverride.totalPrice, 23, 'a new premium never re-prices a sold line');
  const withoutOverride = insurance(calculateReservationQuote({ ...STAY, db, lockedOptionLines: locked }));
  assert.equal(withoutOverride.totalPrice, 23, 'a Neat disconnect never re-bills a sold line × nights');
  assert.equal(withoutOverride.billedUnits, 1);
  db.close();
});

test('repriceQuoteWithNeatSync re-runs the engine off the warm cache; preview === billed', () => {
  const db = engineDb();
  const engineInput = { ...STAY, db };
  const quote = calculateReservationQuote(engineInput);
  const cache = fakeCache({ premium: 17.5, fetchedAt: new Date().toISOString() });
  const { quote: repriced, neatPricing } = repriceQuoteWithNeatSync({
    engineInput, quote, settingsModel: fakeSettings(), cacheModel: cache, calculate: calculateReservationQuote,
  });
  assert.equal(neatPricing.unitPrice, 23);
  assert.equal(insurance(repriced).totalPrice, 23, 'the billed line IS the resolved price');
  db.close();
});

test('repriceQuoteWithNeatSync is a no-op on a cold cache or an inactive config', () => {
  const db = engineDb();
  const engineInput = { ...STAY, db };
  const quote = calculateReservationQuote(engineInput);
  const cold = repriceQuoteWithNeatSync({
    engineInput, quote, settingsModel: fakeSettings(), cacheModel: fakeCache(null), calculate: calculateReservationQuote,
  });
  assert.equal(cold.neatPricing, null);
  assert.equal(insurance(cold.quote).totalPrice, 9, 'static tariff');
  const inactive = repriceQuoteWithNeatSync({
    engineInput, quote, settingsModel: { }, cacheModel: fakeCache(null), calculate: calculateReservationQuote,
  });
  assert.equal(inactive.neatPricing, null, 'a settingsModel without neatConfig reads as unconfigured');
  db.close();
});

// ---- the public projection label ----

test('with Neat pricing active a 0-priced insurance stays visible and announces the per-stay tariff', () => {
  const option = { id: 42, title: 'Assurance annulation', priceType: 'per_night', price: 0 };
  assert.equal(toPublicCancellationInsurance(option), null, 'unpriced + inactive → hidden (rule 15)');
  const block = toPublicCancellationInsurance(option, { neatPricingActive: true, amount: 23 });
  assert.equal(block.priceLabel, 'Tarif calculé pour vos dates de séjour');
  assert.equal(block.amount, 23);
});
