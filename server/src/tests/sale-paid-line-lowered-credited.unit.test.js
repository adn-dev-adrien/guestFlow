// specs/pricing-components.md §3 rule 104 (stabilisation loop t4, S4-3, 2026-11-16) — a line paid now (cash, card terminal) then offered or
// discounted: the money the note collected stays credited to the stay. It comes off what the stay still asks (the open arrival complement
// first); what no open bucket can take is the trop-perçu of rule 23 (409 OVERPAID, then the `lineLowered` obligation); on a platform stay with
// nothing left to ask the gesture is refused. Before: the note's surplus was clamped away and the SAS asked the guest again for it.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');
const { splitMidStayExtras } = require('../utils/pricing/settlement');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (v) => Math.round(Number(v || 0) * 100);
const patch = (id, body) => {
  let status = 200;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  ctrl.updatePayment({ params: { id: String(id) }, body, query: {}, user: { id: 1, role: 'admin' } }, res);
  return status;
};
const notes = (id) => JSON.parse(row(id).midStaySettledNotes || '[]').reduce((sum, note) => sum + cents(note.total), 0);
// Σ (acompte, solde, complements, notes) − (price + tax): 0 while every cent received sits in a bucket.
const unabsorbed = (id) => {
  const r = row(id);
  return cents(r.depositAmount) + cents(r.balanceAmount) + cents(r.complementAmount) + cents(r.endOfStayComplementAmount) + notes(id)
    - cents(r.finalPrice) - cents(r.touristTaxTotal);
};
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);

// A direct stay, solde paid, a 45 € basket due in the arrival complement, started; 30 € of beer sold and paid in cash the day after the arrival.
function paidBeerOnOpenComplement({ platform = 'direct', basket = true } = {}) {
  const id = stay(20);
  if (platform !== 'direct') db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }).status, 200);
  if (basket) assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }], { now: at(id, '12:00', -3) }).status, 200);
  assert.equal(patch(id, { balancePaid: true, balancePaidDate: todayIso() }), 200);
  assert.equal(patch(id, { checkInDone: true }), 200);
  const sold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at(id, '12:00', 1), payment: 'cash' });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  const ref = sold.saleDetail.lines.find((line) => line.articleKey === `option:${beer}`).ref;
  return { id, ref };
}

test('S4-3 — a cash line offered: the 30 € come off the arrival complement still due, nothing is owed back', () => {
  const { id, ref } = paidBeerOnOpenComplement();
  assert.equal(cents(row(id).complementAmount), 4500);
  const offered = extraSale.changeLine(id, ref, { offered: true }, { now: at(id, '12:30', 1) });
  assert.equal(offered.status, 200, JSON.stringify(offered.body));
  assert.equal(cents(row(id).complementAmount), 1500);
  assert.equal(offered.saleDetail.buckets.arrival, 1500);
  assert.equal(unabsorbed(id), 0);
  assert.equal(owed(id), 0);
});

test('S4-3 — a cash line discounted 10 €: the arrival complement asks 10 € less', () => {
  const { id, ref } = paidBeerOnOpenComplement();
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 10 } }, { now: at(id, '12:30', 1) }).status, 200);
  assert.equal(cents(row(id).complementAmount), 3500);
  assert.equal(unabsorbed(id), 0);
});

test('S4-3 — nothing left to ask (a direct stay): 409 OVERPAID, then the confirmed refund owed, no bucket below zero', () => {
  const { id, ref } = paidBeerOnOpenComplement({ basket: false });
  const refused = extraSale.changeLine(id, ref, { offered: true }, { now: at(id, '12:30', 1) });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'OVERPAID');
  const forced = extraSale.changeLine(id, ref, { offered: true }, { now: at(id, '12:30', 1), forceOverpayment: true });
  assert.equal(forced.status, 200, JSON.stringify(forced.body));
  assert.equal(owed(id), 3000);
  assert.ok(cents(row(id).complementAmount) >= 0);
  assert.equal(unabsorbed(id) - owed(id), 0);
});

test('S4-3, loop t5 A5-1 — nothing left to ask on a platform stay: the cash is the establishment\'s, 409 OVERPAID, then owed back', () => {
  const { id, ref } = paidBeerOnOpenComplement({ platform: 'Booking', basket: false });
  const before = row(id);
  const refused = extraSale.changeLine(id, ref, { offered: true }, { now: at(id, '12:30', 1) });
  assert.deepEqual([refused.status, refused.body.code], [409, 'OVERPAID']);
  assert.equal(row(id).finalPrice, before.finalPrice);
  assert.equal(extraSale.changeLine(id, ref, { offered: true }, { now: at(id, '12:30', 1), forceOverpayment: true }).status, 200);
  assert.equal(owed(id), 3000);
  assert.equal(unabsorbed(id) - owed(id), 0);
});

test('S4-3 — the split names the note money no line claims any more', () => {
  const note = [{ id: 1, total: 12, lines: [{ label: 'Petit-déjeuner', amount: 12, key: 'opt:9' }] }];
  const split = splitMidStayExtras([], '{}', note);
  assert.equal(split.unclaimed, 12);
  assert.equal(split.total, 0, 'the carve-out itself is unchanged');
  assert.equal(splitMidStayExtras([{ optionId: 9, title: 'Petit-déjeuner', totalPrice: 12, unitPrice: 12 }], '{}', note).unclaimed, undefined);
});
