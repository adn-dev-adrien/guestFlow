// specs/tariff-recipes/spec.md §3 rule 62 (spec review 2026-10-27) — the tariff snapshot is refreshed by
// every save that rewrites the nights, so a night added later carries its season and a stay repriced
// because its arrival moved (rule 57) replays that reprice. Before: a notes-only save moved the price.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');

function seedManual() {
  f.seed();
  f.db.prepare(`INSERT INTO properties (id, name, maxGuests, singleBeds, doubleBeds, defaultCheckIn, defaultCheckOut,
      depositEnabled, depositPercent, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit)
    VALUES (2, 'Manuel', 6, 2, 2, '16:00', '11:00', 1, 30, 2, 20, 'per_night')`).run();
  f.db.prepare(`INSERT INTO pricing_rules (id, propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges)
    VALUES (20, 2, 'Été', 100, 'progressive', ?, ?)`)
    .run(JSON.stringify([{ nightNumber: 2, extraNightPrice: 60 }, { nightNumber: 3, extraNightPrice: 60 }]),
      JSON.stringify([{ startDate: f.inDays(0), endDate: f.inDays(400) }]));
}

const snapshotOf = (id) => JSON.parse(f.rowOf(id).tariffSnapshot || 'null');

test('a notes-only save after an extension and an arrival move keeps the price', async () => {
  seedManual();
  const id = f.createStay({ propertyId: 2, startDate: f.inDays(210), endDate: f.inDays(213), adults: 3 });
  f.db.prepare('UPDATE pricing_rules SET pricePerNight = 125 WHERE id = 20').run();
  assert.equal((await f.save(id, { endDate: f.inDays(214) })).statusCode, 200);
  assert.ok(snapshotOf(id).extraGuestNights[f.inDays(213)], 'the added night is in the snapshot');
  assert.equal((await f.save(id, { startDate: f.inDays(209) })).statusCode, 200);
  const moved = f.rowOf(id).finalPrice;

  assert.equal((await f.save(id, { notes: 'Rien ne change' })).statusCode, 200);
  assert.equal(f.rowOf(id).finalPrice, moved);
});

test('the snapshot keeps the tariff it was sold under while the arrival stays', async () => {
  const id = f.createStay({ propertyId: 2, startDate: f.inDays(240), endDate: f.inDays(243), adults: 3 });
  const sold = snapshotOf(id);
  f.db.prepare('UPDATE properties SET extraGuestPrice = 35 WHERE id = 2').run();
  assert.equal((await f.save(id, { notes: 'x' })).statusCode, 200);
  const after = snapshotOf(id);
  assert.equal(after.extraGuestPrice, sold.extraGuestPrice);
  assert.deepEqual(after.extraGuestNights[f.inDays(240)], sold.extraGuestNights[f.inDays(240)]);
  f.db.prepare('UPDATE properties SET extraGuestPrice = 20 WHERE id = 2').run();
});

test('a stored tier table survives a save whose party prices no tier', async () => {
  const id = f.createStay({ propertyId: 2, startDate: f.inDays(271), endDate: f.inDays(274), adults: 3 });
  const tiers = [{ fromNight: 1, price: 15 }, { fromNight: 2, price: 8 }];
  f.db.prepare('UPDATE reservations SET tariffSnapshot = ? WHERE id = ?')
    .run(JSON.stringify({ ...snapshotOf(id), extraGuestTiers: tiers }), id);
  assert.equal((await f.save(id, { adults: 2 })).statusCode, 200);
  assert.deepEqual(snapshotOf(id).extraGuestTiers, tiers);
});
