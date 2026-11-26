// specs/pricing/pricing-components.md §3 rule 108, reading of 2026-11-16 (stabilisation loop t9, B9-4, OLD) — the owner decision « a paid line offered
// whose money was refunded is sold anew, never put back » holds for a line the paid SOLDE carried, not only a note's: the beer ×5 (30 €) in a
// paid solde of 330 €, offered, its 30 € trop-perçu refunded, then un-offered (or un-discounted) answers 409 `LINE_REFUNDED` on the line API
// and the fiche, and the fiche is served the line in `refundedLoweredLines`. Before (master too), the save went through: total 330 €, nothing
// asked, the guest kept the beer AND the 30 €. A line whose freed money the stay still holds is never refused.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./stayIdentityFixtures');
const paidLineJudgment = require('../utils/paidLineJudgment');

const plank = F.option('Planche remboursée', 20);
const beerLine = (id) => F.db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, F.beer).lineId;

function offeredAndRefunded(want = { offered: true }) {
  const id = F.paidStay('direct');
  assert.equal(F.change(id, F.beer, want, F.at(id, -3, '10:00')).final.status, 200);
  assert.deepEqual(F.refundAsProposed(id).map((r) => r.statusCode), [201]);
  return id;
}

test('B9-4: the line API refuses to un-offer a solde line whose trop-perçu was refunded', () => {
  const id = offeredAndRefunded();
  const back = F.extraSale.changeLine(id, F.lineRef(id, F.beer, F.at(id, -3, '11:00')), { offered: false }, { now: F.at(id, -3, '11:00') });
  assert.equal(back.status, 409);
  assert.equal(back.body.code, 'LINE_REFUNDED');
  assert.equal(F.cents(F.row(id).finalPrice), 30000, 'nothing written');
  assert.equal(F.identity(id).gap, 0);
});

test('B9-4: the fiche refuses it too, and is served the line as refunded', () => {
  const id = offeredAndRefunded();
  assert.deepEqual(paidLineJudgment.refundedLoweredLines(F.db, id).map((l) => [l.key, l.table, l.lineId]), [[`opt:${F.beer}`, 'option', beerLine(id)]]);
  const back = F.fiche(id, (options) => options.map((o) => (Number(o.optionId) === F.beer ? { ...o, offered: false } : o)), F.at(id, -3, '11:00'));
  assert.equal(back.first.status, 409);
  assert.equal(back.first.body.code, 'LINE_REFUNDED');
});

test('B9-4: a discount whose 6 € were refunded cannot be taken back either', () => {
  const id = offeredAndRefunded({ discount: { amount: 6 } });
  const back = F.extraSale.changeLine(id, F.lineRef(id, F.beer, F.at(id, -3, '11:00')), { discount: null }, { now: F.at(id, -3, '11:00') });
  assert.equal(back.status, 409);
  assert.equal(back.body.code, 'LINE_REFUNDED');
});

test('B9-4: not refunded, or the refund deleted, the line is put back (200) and nothing is owed', () => {
  const kept = F.paidStay('direct');
  assert.equal(F.change(kept, F.beer, { offered: true }, F.at(kept, -3, '10:00')).final.status, 200);
  assert.deepEqual(paidLineJudgment.refundedLoweredLines(F.db, kept), []);
  assert.equal(F.change(kept, F.beer, { offered: false }, F.at(kept, -3, '11:00')).final.status, 200);
  assert.deepEqual([F.identity(kept).owed, F.identity(kept).gap], [0, 0]);

  const deleted = offeredAndRefunded();
  assert.equal(F.deleteRefund(deleted, F.refundIds(deleted)[0]).statusCode, 200);
  assert.equal(F.change(deleted, F.beer, { offered: false }, F.at(deleted, -3, '11:00')).final.status, 200);
  assert.deepEqual([F.identity(deleted).owed, F.identity(deleted).gap], [0, 0]);
});

test('B9-4: a refund of other money never locks a line whose freed money the stay still holds', () => {
  const id = F.paidStay('direct');
  assert.equal(F.change(id, F.beer, { discount: { amount: 6 } }, F.at(id, -3, '10:00')).final.status, 200);
  assert.deepEqual(F.refundAsProposed(id).map((r) => r.statusCode), [201]);
  // The plank the collected arrival complement paid, offered later: its 20 € are still held — it can be put back.
  assert.equal(F.sell(id, plank, 1, F.at(id, -3, '11:00')).status, 200);
  F.pay(id, { complementPaid: true, complementPaidDate: F.todayIso() });
  assert.equal(F.change(id, plank, { offered: true }, F.at(id, -3, '12:00')).final.status, 200);
  assert.equal(F.change(id, plank, { offered: false }, F.at(id, -3, '13:00')).final.status, 200);
  assert.equal(F.identity(id).gap, 0);
});
