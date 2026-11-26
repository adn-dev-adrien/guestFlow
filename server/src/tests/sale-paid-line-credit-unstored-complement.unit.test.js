// specs/pricing/pricing-components.md §3 rule 122 (stabilisation loop t9, S9-2, 2026-11-16; completes rules 104, 118) — a stay priced before 4.2.0 whose
// open arrival complement the engine of today sets above the stored one (stay 14: the engine prices it 50 € higher than it was sold). The note
// credit of a paid line never lands on that unstored part: it goes to the end-of-stay remainder, the solde, the acompte, as the arrival SAS's
// offer does. Before: the line API answered 409 OVERPAID, and forced, owed the 30 € back while the remainder still asked them in full; a line
// sold while that obligation was open did not absorb it either.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { withNow } = require('../utils/localDate');
const { storedBody } = require('../utils/stayOrderLines');

const ADMIN = { id: 1, roles: ['admin'] };
const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (v) => Math.round(Number(v || 0) * 100);
const notes = (id) => JSON.parse(row(id).midStaySettledNotes || '[]').reduce((sum, note) => sum + cents(note.total), 0);
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
const balanced = (id) => {
  const r = row(id);
  return cents(r.depositAmount) + cents(r.balanceAmount) + cents(r.complementAmount) + cents(r.endOfStayComplementAmount) + notes(id) - owed(id)
    - cents(r.finalPrice) - cents(r.touristTaxTotal);
};
const remainder = (id) => cents(row(id).endOfStayComplementAmount);
const beerRef = (id, now) => extraSale.saleDetailOf(id, now).lines.find((line) => line.articleKey === `option:${beer}`).ref;

// Sold 300 € and its solde paid, a beer ordered in the app 3 days before the arrival and paid by card (30 €); the stay is one of before 4.2.0
// (no stored extra-guest record, no tariff snapshot) and the lodging bills since 20 € per stay beyond one guest: the engine of today prices it
// 320 € and its arrival complement asks 20 € the stay does not store.
function driftedStayWithCardLine() {
  db.prepare('UPDATE properties SET basePriceIncludedGuests = 0, extraGuestPrice = 0 WHERE id = 9701').run();
  const id = stay(3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now: at(id, '12:00', -4) }).status, 200);
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  withNow(at(id, '12:00', -4), () => ctrl.updatePayment({ params: { id: String(id) }, body: { balancePaid: true }, query: {}, user: ADMIN }, res));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const now = at(id, '12:00', -3);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  const card = extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1' });
  assert.equal(card.status, 200, JSON.stringify(card.body));
  db.prepare('UPDATE reservations SET readsSaleLines = 0, storedExtraGuests = NULL, tariffSnapshot = NULL WHERE id = ?').run(id);
  db.prepare('UPDATE properties SET basePriceIncludedGuests = 1, extraGuestPrice = 20 WHERE id = 9701').run();
  return id;
}
const checkIn = (id) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  withNow(at(id, '15:00'), () => ctrl.updatePayment({ params: { id: String(id) }, body: { checkInDone: true }, query: {}, user: ADMIN }, res));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
};
const sellBasket = (id, now) => {
  const sold = extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }], { now });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
};

test('S9-2 — during the stay, the line API offering the paid line credits the end-of-stay remainder, not the unstored complement: nothing owed', () => {
  const id = driftedStayWithCardLine();
  checkIn(id);
  const now = at(id, '12:00', 1);
  sellBasket(id, now);
  assert.equal(remainder(id), 4500);
  const before = balanced(id);
  const offered = extraSale.changeLine(id, beerRef(id, now), { offered: true }, { now, forceOverpayment: true });
  assert.equal(offered.status, 200, JSON.stringify(offered.body));
  assert.deepEqual([remainder(id), owed(id), cents(row(id).complementAmount)], [1500, 0, 0], 'the 30 € paid the basket, the stored complement untouched');
  assert.equal(balanced(id), before);
});

test('S9-2 — offered before the arrival (forced, 30 € owed), then a 45 € line sold during the stay: the obligation pays the line', () => {
  const id = driftedStayWithCardLine();
  const early = at(id, '12:00', -2);
  const forced = extraSale.changeLine(id, beerRef(id, early), { offered: true }, { now: early, forceOverpayment: true });
  assert.equal(forced.status, 200, JSON.stringify(forced.body));
  assert.equal(owed(id), 3000, 'nothing the stay stores absorbs it before the arrival');
  checkIn(id);
  const before = balanced(id);
  sellBasket(id, at(id, '12:00', 1));
  assert.deepEqual([remainder(id), owed(id)], [1500, 0]);
  assert.equal(balanced(id), before);
});
