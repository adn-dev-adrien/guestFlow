// Per-property public payment mode (specs/public-online-deposit.md): deposit vs full decision, the raw
// stored deposit amount (anti-drift), and the deposit VAT components.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { resolvePublicPaymentMode, depositPaymentCents, depositPaymentComponents } = require('../utils/publicPaymentMode');

function seed({ enabled = 0, depositAmount = 90 } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, publicDepositEnabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, propertyId INTEGER, depositAmount REAL);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL);
  `);
  db.prepare('INSERT INTO properties (id, name, publicDepositEnabled) VALUES (1, ?, ?)').run('Gite', enabled);
  db.prepare('INSERT INTO reservations (id, propertyId, depositAmount) VALUES (10, 1, ?)').run(depositAmount);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  return db;
}

test('mode = deposit only when the property opted in AND the deposit is positive', () => {
  assert.equal(resolvePublicPaymentMode(seed({ enabled: 1 }), 1, 9000), 'deposit');
  assert.equal(resolvePublicPaymentMode(seed({ enabled: 0 }), 1, 9000), 'full', 'not opted in → full');
  assert.equal(resolvePublicPaymentMode(seed({ enabled: 1 }), 1, 0), 'full', 'zero deposit → full even if opted in');
});

// specs/deposit-blocks-the-dates.md rule 16 — the last-minute switch reaches the website for free: with
// no acompte on the devis, the mode falls back to `full`, so the site charges the stay once instead of
// displaying an Acompte/Solde plan that no longer means anything. No plugin change, hence this anchor.
test('a last-minute devis (no acompte) makes the website ask for the whole stay', () => {
  const db = seed({ enabled: 1, depositAmount: 0 });
  assert.equal(resolvePublicPaymentMode(db, 1, depositPaymentCents(db, 10)), 'full');
});

test('mode is defensive: a missing column / unknown property → full (never throws)', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT)'); // no publicDepositEnabled column
  db.prepare('INSERT INTO properties (id, name) VALUES (1, ?)').run('Gite');
  assert.equal(resolvePublicPaymentMode(db, 1, 9000), 'full');
  assert.equal(resolvePublicPaymentMode(seed({ enabled: 1 }), 999, 9000), 'full', 'unknown property → full');
});

test('depositPaymentCents reads the RAW stored column (anti-drift), not a recompute', () => {
  const db = seed({ depositAmount: 63.08 });
  assert.equal(depositPaymentCents(db, 10), 6308);
  // Falls back to the passed row when the lookup misses.
  assert.equal(depositPaymentCents(db, 999, { depositAmount: 12.5 }), 1250);
  assert.equal(depositPaymentCents(db, 999, null), 0);
});

test('depositPaymentComponents: single taxable accommodation line at the global VAT rate', () => {
  const db = seed({ depositAmount: 116.48 });
  const { components, vatRatePercent } = depositPaymentComponents(db, 10);
  assert.equal(vatRatePercent, 10);
  assert.deepEqual(components, [{ title: 'Acompte séjour', grossCents: 11648, taxable: true }]);
});
