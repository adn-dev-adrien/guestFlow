// specs/plugins-phase-3b-neat.md rules 1–4 — a plugin adjusts a quote through one closed output, the
// insurance unit price; the core re-runs its own engine with it, and a failing or absent plugin never
// moves a price.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const quotePostProcessors = require('../utils/quotePostProcessors');

const processor = (over = {}) => ({
  id: 'neat',
  isReady: () => true,
  priceSync: () => ({ cancellationInsurancePrice: 23 }),
  priceLive: async () => ({ cancellationInsurancePrice: 25 }),
  ...over,
});

function live(ids) {
  registry.reset();
  registry.configure({ isActive: (id) => ids.includes(id), allows: () => true });
}

function engineDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE options (id INTEGER PRIMARY KEY, isCancellationInsurance INTEGER DEFAULT 0);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO options VALUES (10, 1); INSERT INTO properties VALUES (1, 'Gîte');`);
  return db;
}

// A stand-in engine: it reports the override it was given, so the test sees what the core passed.
const calculate = (input) => ({ override: input.cancellationInsurancePriceOverride ?? null, optionLines: [] });
const firstRun = { nights: 3, persons: 2, totalStayPrice: 300, cancellationInsuranceBase: 300, optionLines: [] };
const silent = { warn: () => {}, error: () => {} };

test.afterEach(() => registry.reset());

test('rule 1 — a processor lacking a member fails the registration', () => {
  live(['neat']);
  assert.throws(() => createContext('neat', {}).quotePostProcessor(processor({ priceLive: undefined })), /lacks "priceLive"/);
});

test('rule 1 — one processor per output key', () => {
  live(['neat', 'other-insurer']);
  createContext('neat', {}).quotePostProcessor(processor());
  assert.throws(() => createContext('other-insurer', {}).quotePostProcessor(processor({ id: 'other' })), /already declared by neat/);
});

test('rule 2 — saves read the sync price, previews the live one; the engine re-runs with it', async () => {
  live(['neat']);
  createContext('neat', {}).quotePostProcessor(processor());
  const engineInput = { db: engineDb(), propertyId: 1, startDate: '2026-11-10', endDate: '2026-11-13' };
  assert.equal(quotePostProcessors.applySync({ engineInput, quote: firstRun, calculate }).override, 23);
  assert.equal((await quotePostProcessors.applyLive({ engineInput, quote: firstRun, calculate })).override, 25);
  assert.equal(quotePostProcessors.dynamicInsurance(), true);
});

test('rule 1 — the output is closed: an unknown key or a non-amount is ignored', async () => {
  live(['neat']);
  createContext('neat', {}).quotePostProcessor(processor({
    priceSync: () => ({ cancellationInsurancePrice: 23, discountPercent: 50 }),
    priceLive: async () => ({ cancellationInsurancePrice: -4 }),
  }));
  const engineInput = { db: engineDb(), propertyId: 1, startDate: '2026-11-10', endDate: '2026-11-13' };
  assert.equal(quotePostProcessors.applySync({ engineInput, quote: firstRun, calculate, logger: silent }).override, 23, 'only the price is read');
  assert.equal(await quotePostProcessors.applyLive({ engineInput, quote: firstRun, calculate, logger: silent }), firstRun, 'a negative price leaves the quote');
});

test('rule 1 — a processor that throws leaves the quote as computed', async () => {
  live(['neat']);
  createContext('neat', {}).quotePostProcessor(processor({
    priceSync: () => { throw new Error('boom'); },
    priceLive: async () => { throw new Error('Neat down'); },
  }));
  const engineInput = { db: engineDb(), propertyId: 1, startDate: '2026-11-10', endDate: '2026-11-13' };
  assert.equal(quotePostProcessors.applySync({ engineInput, quote: firstRun, calculate, logger: silent }), firstRun);
  assert.equal(await quotePostProcessors.applyLive({ engineInput, quote: firstRun, calculate, logger: silent }), firstRun);
});

test('rule 4 — an inactive plugin declares nothing the core calls; ready or not, the insurance follows the plugin', async () => {
  live([]);
  let called = 0;
  let ready = false;
  createContext('neat', {}).quotePostProcessor(processor({
    isReady: () => ready,
    priceLive: async () => { called += 1; return { cancellationInsurancePrice: 25 }; },
  }));
  const engineInput = { db: engineDb(), propertyId: 1, startDate: '2026-11-10', endDate: '2026-11-13' };
  assert.equal(await quotePostProcessors.applyLive({ engineInput, quote: firstRun, calculate }), firstRun);
  assert.equal(called, 0, 'no Neat call while the plugin is off');
  assert.equal(quotePostProcessors.insuranceOffered(), false);
  assert.equal(quotePostProcessors.dynamicInsurance(), false);

  registry.configure({ isActive: () => true });
  assert.equal(quotePostProcessors.insuranceOffered(), true, 'live but unconfigured: offered at its Options price');
  assert.equal(quotePostProcessors.dynamicInsurance(), false);
  assert.equal(await quotePostProcessors.applyLive({ engineInput, quote: firstRun, calculate }), firstRun);
  ready = true;
  assert.equal(quotePostProcessors.dynamicInsurance(), true);
});
