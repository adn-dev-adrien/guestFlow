// specs/tariff-recipes/spec.md §3 rule 59 (audit 2026-10-27) — a night no season covers is named in the
// quote, so the public flows can refuse it and the fiche can warn.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateReservationQuote, hasUnpricedNights } = require('../utils/pricing');
const { pricingAuditDb, STAY, storedNights } = require('./pricingAuditFixture');

function mayOnly() {
  const db = pricingAuditDb({ included: 10 });
  db.prepare('UPDATE pricing_rules SET pricePerNight = 180, dateRanges = ? WHERE id = 1')
    .run(JSON.stringify([{ startDate: '2026-05-01', endDate: '2026-05-31' }]));
  return db;
}

test('a night past the last season is priced 100 € by default and named', () => {
  const q = calculateReservationQuote({ ...STAY, db: mayOnly(), platform: 'direct', startDate: '2026-05-30', endDate: '2026-06-02' });
  assert.equal(q.finalPrice, 460);
  assert.deepEqual(q.unpricedNights, ['2026-06-01']);
  assert.equal(hasUnpricedNights(q), true);
});

test('every night covered: nothing named', () => {
  const q = calculateReservationQuote({ ...STAY, db: mayOnly(), platform: 'direct', startDate: '2026-05-10', endDate: '2026-05-12' });
  assert.deepEqual(q.unpricedNights, []);
  assert.equal(hasUnpricedNights(q), false);
});

test('a saved stay keeps naming the night: the lock carries a price no season gives', () => {
  const db = mayOnly();
  const sold = calculateReservationQuote({ ...STAY, db, platform: 'direct', startDate: '2026-05-30', endDate: '2026-06-02' });
  const nights = storedNights(sold).map((n) => (n.date === '2026-06-01' ? { ...n, price: 190 } : n));
  const replay = calculateReservationQuote({ ...STAY, db, platform: 'direct', startDate: '2026-05-30', endDate: '2026-06-02', lockedNightlyBreakdown: nights });
  assert.deepEqual(replay.unpricedNights, ['2026-06-01']);
  assert.equal(replay.nightlyBreakdown[2].price, 190, 'the sold price itself is kept');
});
