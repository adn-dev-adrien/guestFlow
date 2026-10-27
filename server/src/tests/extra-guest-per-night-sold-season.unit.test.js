// specs/tariff-recipes/spec.md §3 rule 58 (audit 2026-10-27) — the per-night extra-guest supplement of
// a sold reservation replays the season it was sold under, not the live season price.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateReservationQuote } = require('../utils/pricing');
const { pricingAuditDb, STAY, storedNights } = require('./pricingAuditFixture');

const ARGS = { platform: 'direct', adults: 3, startDate: '2026-05-10', endDate: '2026-05-13' };

function soldAt100() {
  const db = pricingAuditDb({ unit: 'per_night', included: 2, extraGuestPrice: 20 });
  db.prepare('UPDATE pricing_rules SET pricePerNight = 100 WHERE id = 1').run();
  const sold = calculateReservationQuote({ ...STAY, db, ...ARGS });
  return { db, sold };
}

test('sold 20 €/night × 3 = 60 €, and the snapshot names each night\'s season', () => {
  const { sold } = soldAt100();
  assert.equal(sold.extraGuestSurcharge, 60);
  assert.deepEqual(sold.tariffSnapshot.extraGuestNights['2026-05-10'], { base: 100, unit: 20 });
});

for (const [livePrice, seasonUnit, label] of [[125, null, 'season raised (was 48)'], [80, null, 'season lowered (was 75)'], [100, 35, 'season supplement changed']]) {
  test(`${label}: the sold reservation still bills 60 €`, () => {
    const { db, sold } = soldAt100();
    db.prepare('UPDATE pricing_rules SET pricePerNight = ?, extraGuestPrice = ? WHERE id = 1').run(livePrice, seasonUnit);
    const replay = calculateReservationQuote({ ...STAY, db, ...ARGS, lockedNightlyBreakdown: storedNights(sold), lockedTariff: sold.tariffSnapshot });
    assert.equal(replay.extraGuestSurcharge, 60);
    assert.equal(replay.finalPrice, 360);
  });
}

test('a night added after the sale takes the live season', () => {
  const { db, sold } = soldAt100();
  db.prepare('UPDATE pricing_rules SET pricePerNight = 125 WHERE id = 1').run();
  const longer = calculateReservationQuote({
    ...STAY, db, ...ARGS, endDate: '2026-05-14', lockedNightlyBreakdown: storedNights(sold), lockedTariff: sold.tariffSnapshot,
  });
  assert.equal(longer.extraGuestSurcharge, 80, '3 sold nights at 20 € + the new one at 125/125 × 20 €');
});
