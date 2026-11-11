// specs/mid-stay-extras-to-end-of-stay-complement.md rule 20 (audit 2026-10-27) — an extra routed to an
// arrival complement already collected is billed at check-out, so the buckets always add up.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateReservationQuote } = require('../utils/pricing');
const { ARRIVAL_COMPLEMENT_EXCESS_KEY } = require('../utils/midStayExtras');
const { pricingAuditDb, STAY } = require('./pricingAuditFixture');

function db() {
  const d = pricingAuditDb({ depositPercent: 30, included: 10 });
  d.prepare('UPDATE pricing_rules SET pricePerNight = 100 WHERE id = 1').run();
  d.prepare("INSERT INTO options (id, title, priceType, price) VALUES (12, 'Bois', 'per_stay', 30)").run();
  d.prepare('INSERT INTO property_options VALUES (1, 12)').run();
  return d;
}
const ARGS = {
  platform: 'direct', startDate: '2027-07-10', endDate: '2027-07-13', bookingDate: '2026-10-01',
  selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 1 }, { optionId: 12, quantity: 1, inComplement: 1 }],
  complementPaid: true, complementAmount: 80,
};
const buckets = (q) => Math.round((q.depositAmount + q.balanceAmount + q.complementAmount + q.endOfStayComplementTotal) * 100) / 100;

test('complement of 80 collected before the stay, 30 € of wood added on it: billed at check-out (was nowhere)', () => {
  const q = calculateReservationQuote({ ...STAY, db: db(), ...ARGS });
  assert.equal(q.finalPrice, 410);
  assert.equal(q.complementAmount, 80, 'the collected complement stays frozen');
  assert.equal(q.endOfStayComplementTotal, 30);
  assert.deepEqual(q.midStayExtrasLines.map((l) => [l.key, l.amount]), [[ARRIVAL_COMPLEMENT_EXCESS_KEY, 30]]);
  assert.equal(buckets(q), q.finalPrice);
  assert.equal(q.sejourNetTotal, 410);
  assert.equal(q.headline.amount, 410, 'the excess sits inside finalPrice: the gross does not count it twice');
});

test('settled through a mid-stay note: nothing left at check-out, the money still in the total', () => {
  const notes = JSON.stringify([{ id: 1, total: 30, lines: [{ key: ARRIVAL_COMPLEMENT_EXCESS_KEY, amount: 30 }] }]);
  const q = calculateReservationQuote({ ...STAY, db: db(), ...ARGS, midStaySettledNotes: notes });
  assert.equal(q.endOfStayComplementTotal, 0);
  assert.equal(q.midStaySettledTotal, 30);
  assert.equal(q.sejourNetTotal, 410);
});

test('once the end-of-stay complement is collected, the stored line keeps the acompte / solde untouched', () => {
  const live = calculateReservationQuote({ ...STAY, db: db(), ...ARGS });
  const frozen = calculateReservationQuote({
    ...STAY, db: db(), ...ARGS, endOfStayComplementSettled: true, frozenMidStayLines: live.midStayExtrasLines,
  });
  assert.deepEqual([frozen.depositAmount, frozen.balanceAmount, frozen.complementAmount], [live.depositAmount, live.balanceAmount, 80]);
  assert.equal(frozen.endOfStayComplementTotal, 30);
});

test('a complement adjusted by the operator is his decision: nothing moves', () => {
  const q = calculateReservationQuote({ ...STAY, db: db(), ...ARGS, complementAmountOverride: 80 });
  assert.equal(q.endOfStayComplementTotal, 0);
});
