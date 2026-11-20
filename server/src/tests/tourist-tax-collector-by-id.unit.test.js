// specs/pricing-components.md §3 rules 3 and 70 (D1, PLAT O1) — the tourist-tax `collector` asks the channel whether a stay is
// the operator's own (`saleChannel`), never compares the platform to the word « direct » by hand. An unmatched platform keeps
// the legacy default (the platform collects, the operator does not remit): no figure moves (Q-B18).
const test = require('node:test');
const assert = require('node:assert/strict');
const { platformCollectsTouristTax, touristTaxRemittedByOwner } = require('../utils/pricing/touristTax');

const OWNER_COLLECTS = { c: 0, r: 0 };
const PLATFORM_COLLECTS_AND_REMITS = { c: 1, r: 1 };

test('rule 3 (D1) — the operator\'s own channel charges and remits the tax, however the word is written', () => {
  for (const platform of ['direct', 'Direct', ' direct ', '', null, undefined]) {
    assert.equal(platformCollectsTouristTax(platform, PLATFORM_COLLECTS_AND_REMITS), false, `collects « ${platform} »`);
    assert.equal(touristTaxRemittedByOwner(platform, OWNER_COLLECTS), true, `remits « ${platform} »`);
  }
});

test('rule 3 (D1) — a named platform reads its stored mode; an unmatched one keeps the legacy default', () => {
  assert.equal(platformCollectsTouristTax('Booking.com', PLATFORM_COLLECTS_AND_REMITS), true);
  assert.equal(platformCollectsTouristTax('Booking.com', OWNER_COLLECTS), false);
  assert.equal(touristTaxRemittedByOwner('Booking.com', PLATFORM_COLLECTS_AND_REMITS), false);
  assert.equal(touristTaxRemittedByOwner('Booking.com', { c: 1, r: 0 }), true);
  assert.equal(platformCollectsTouristTax('Plateforme inconnue', null), true, 'legacy: an unmatched platform collects');
  assert.equal(touristTaxRemittedByOwner('Plateforme inconnue', null), false, 'legacy: an unmatched platform remits itself');
});

test('rule 70 — the stored platform mode is resolved only for a named channel', () => {
  const Database = require('better-sqlite3');
  const { resolveGlobalPlatformTaxRow } = require('../models/pricingInputModel');
  const db = new Database(':memory:');
  db.exec("CREATE TABLE platforms (name TEXT, collectsTouristTax INTEGER, touristTaxRemittedByPlatform INTEGER); INSERT INTO platforms VALUES ('direct', 1, 1), ('Booking.com', 1, 0);");
  assert.equal(resolveGlobalPlatformTaxRow(db, 'direct'), null);
  assert.equal(resolveGlobalPlatformTaxRow(db, 'Direct'), null);
  assert.deepEqual({ ...resolveGlobalPlatformTaxRow(db, 'booking.com') }, { c: 1, r: 0 });
  assert.equal(resolveGlobalPlatformTaxRow(db, 'Autre'), null);
});
