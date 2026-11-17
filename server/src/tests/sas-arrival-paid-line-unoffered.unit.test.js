// specs/pricing-components.md §3 rules 23, 104, 105, 107 and 109, specs/sas-offer-complement-lines.md §4.3 (stabilisation loop t7, S7-1,
// 2026-11-16) — « Offert » unticked at the arrival SAS on a line the guest paid by card follows the fiche's way back: the line is billed again,
// its note pays it again, so the obligation the offer opened closes; and the credit the offer gave to a solde not yet paid is asked again.
// Before: the commit re-billed the line and left the obligation open (the fiche invited a refund of money that pays a billed line), or left
// the solde lowered (the line's price never asked again — prod stays 22303 / 22306).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const reservations = require('../models/reservationsModel');
const { withNow } = require('../utils/localDate');
const { storedBody } = require('../utils/stayOrderLines');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (v) => Math.round(Number(v || 0) * 100);
const notes = (id) => JSON.parse(row(id).midStaySettledNotes || '[]').reduce((sum, note) => sum + cents(note.total), 0);
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
const balanced = (id) => {
  const r = row(id);
  return cents(r.depositAmount) + cents(r.balanceAmount) + cents(r.complementAmount) + cents(r.endOfStayComplementAmount) + notes(id) - owed(id)
    - cents(r.finalPrice) - cents(r.touristTaxTotal);
};
const beerLine = (id) => db.prepare('SELECT lineId, offered, totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, beer);

// A stay whose plan is paid (or not), a beer ordered in the app and paid by card, then offered through its line action (forced when nothing absorbs it).
function cardLineOffered({ balancePaid }) {
  const id = stay(3);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  if (balancePaid) db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(todayIso(), id);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1' }).status, 200);
  const ref = `option:${beerLine(id).lineId}`;
  let res = extraSale.changeLine(id, ref, { offered: true }, { now });
  if (res.status === 409 && res.body.code === 'OVERPAID') res = extraSale.changeLine(id, ref, { offered: true }, { now, forceOverpayment: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(beerLine(id).offered, 1);
  return id;
}

test('S7-1 — plan paid: the offer opened a 30 € obligation; « Offert » unticked at the arrival SAS bills the line again and closes it, Σ unchanged', () => {
  const id = cardLineOffered({ balancePaid: true });
  assert.equal(owed(id), 3000);
  const before = { balanced: balanced(id), final: cents(row(id).finalPrice) };
  withNow(at(id, '15:00'), () => reservations.commitArrivalSas(id, { complementItems: [], offeredExtras: [] }));
  assert.deepEqual([beerLine(id).offered, cents(row(id).finalPrice) - before.final], [0, 3000], 'billed again');
  assert.deepEqual([owed(id), balanced(id)], [0, before.balanced], 'nothing owed back any more, nothing lost');
  assert.equal(ctrl.storedOverpayment(id).overpaymentTtc, 0, 'no « Trop-perçu » left on the fiche');
});

test('S7-1 — solde not paid: the offer credited it; « Offert » unticked at the arrival SAS asks the solde again, Σ unchanged', () => {
  const id = cardLineOffered({ balancePaid: false });
  assert.equal(owed(id), 0, 'the unpaid solde absorbed the credit');
  const before = { balanced: balanced(id), balance: cents(row(id).balanceAmount), complement: cents(row(id).complementAmount) };
  withNow(at(id, '15:00'), () => reservations.commitArrivalSas(id, { complementItems: [], offeredExtras: [] }));
  assert.equal(beerLine(id).offered, 0);
  const asked = cents(row(id).balanceAmount) - before.balance + cents(row(id).complementAmount) - before.complement;
  assert.deepEqual([asked, owed(id), balanced(id)], [3000, 0, before.balanced], 'the line is asked again');
});

test('S7-1 — the seed sent back untouched (« Offert » kept): nothing moves', () => {
  const id = cardLineOffered({ balancePaid: true });
  const before = { row: row(id), owed: owed(id) };
  const line = beerLine(id);
  withNow(at(id, '15:00'), () => reservations.commitArrivalSas(id, { complementItems: [], offeredExtras: [{ kind: 'option', id: beer, lineId: line.lineId }] }));
  assert.deepEqual([beerLine(id).offered, owed(id)], [1, before.owed]);
  for (const field of ['finalPrice', 'balanceAmount', 'complementAmount', 'depositAmount']) assert.equal(row(id)[field], before.row[field], field);
});

test('S7-1 — the arrival recap played before the commit (rule 90.1) leaves the stay as it was', () => {
  const id = cardLineOffered({ balancePaid: false });
  const before = { row: row(id), owed: owed(id) };
  withNow(at(id, '15:00'), () => reservations.planArrivalSas(id, { complementItems: [], offeredExtras: [] }));
  assert.deepEqual([row(id).balanceAmount, row(id).finalPrice, owed(id), beerLine(id).offered], [before.row.balanceAmount, before.row.finalPrice, before.owed, 1]);
});
