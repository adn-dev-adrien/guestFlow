// specs/tariff-recipes/spec.md §3 rule 57 (operator decision 2026-10-27) — the sold night prices are
// kept only while the ARRIVAL date is unchanged; an arrival moved reprices the whole stay at today's
// tariff, so a progressive tariff keeps its rank logic.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateReservationQuote } = require('../utils/pricing');
const { pricingAuditDb, STAY, storedNights } = require('./pricingAuditFixture');

function progressiveDb() {
  const db = pricingAuditDb({ included: 10 });
  db.prepare("UPDATE pricing_rules SET pricePerNight = 100, pricingMode = 'progressive', progressiveTiers = ? WHERE id = 1")
    .run(JSON.stringify([{ nightNumber: 2, extraNightPrice: 60 }]));
  return db;
}
const prices = (q) => q.nightlyBreakdown.map((n) => n.price);

test('sold 10 → 13 at 100 + 60 + 60', () => {
  const sold = calculateReservationQuote({ ...STAY, db: progressiveDb(), platform: 'direct', startDate: '2026-05-10', endDate: '2026-05-13' });
  assert.deepEqual(prices(sold), [100, 60, 60]);
});

for (const [startDate, endDate, label, expected] of [
  ['2026-05-09', '2026-05-13', 'arrival one day earlier', [100, 60, 60, 60]],
  ['2026-05-11', '2026-05-13', 'arrival one day later', [100, 60]],
  ['2026-05-11', '2026-05-14', 'whole stay shifted by a day', [100, 60, 60]],
]) {
  test(`${label}: repriced at the tariff (was locked by date)`, () => {
    const db = progressiveDb();
    const sold = calculateReservationQuote({ ...STAY, db, platform: 'direct', startDate: '2026-05-10', endDate: '2026-05-13' });
    const moved = calculateReservationQuote({ ...STAY, db, platform: 'direct', startDate, endDate, lockedNightlyBreakdown: storedNights(sold) });
    assert.deepEqual(prices(moved), expected);
  });
}

test('same arrival, departure extended: sold nights kept, the new one priced at the tariff with its rank', () => {
  const db = progressiveDb();
  const sold = calculateReservationQuote({ ...STAY, db, platform: 'direct', startDate: '2026-05-10', endDate: '2026-05-13' });
  db.prepare("UPDATE pricing_rules SET pricePerNight = 120, progressiveTiers = ? WHERE id = 1").run(JSON.stringify([{ nightNumber: 2, extraNightPrice: 70 }]));
  const longer = calculateReservationQuote({ ...STAY, db, platform: 'direct', startDate: '2026-05-10', endDate: '2026-05-14', lockedNightlyBreakdown: storedNights(sold) });
  assert.deepEqual(prices(longer), [100, 60, 60, 70]);
  const shorter = calculateReservationQuote({ ...STAY, db, platform: 'direct', startDate: '2026-05-10', endDate: '2026-05-12', lockedNightlyBreakdown: storedNights(sold) });
  assert.deepEqual(prices(shorter), [100, 60]);
});
