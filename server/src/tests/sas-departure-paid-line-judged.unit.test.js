// specs/pricing-components.md §3 rule 107 d and specs/sas-offer-complement-lines.md §4 (stabilisation loop t7, UI7-2 / UI7-3, 2026-11-16) —
// the DEPARTURE half of the SAS paid-line judgment, and both commits through the HTTP layer. A recalled arrival complement holds a line sold on
// the fiche (unpaid) beside a line ordered in the app and paid by card: the check-out offering both answers 409 OVERPAID, writes nothing, and
// names the paid line by the recap's key (`overpaymentKeys`, so « Garder » on the SAS puts exactly that line back to billed); confirmed with
// `forceOverpayment` both are offered and the card money is owed back. The SAS controller answers the refusal as is and records no
// `sas_arrival` / `sas_departure` history entry for a refused commit.
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
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const registry = require('../plugins/sdk/registry');
const sas = optionalPlugin(() => require('../plugins/sas/controller'));

registry.configure({ isActive: () => true, allows: () => true });

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
const beerLines = (id) => db.prepare('SELECT lineId, offered FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, beer);
const history = (id, eventType) => db.prepare('SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ? AND eventType = ?').get(id, eventType).n;
const call = (fn, id, body) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  sas[fn]({ params: { id: String(id) }, body, user: ADMIN, query: {} }, res);
  return res;
};

// A plan paid in full; beer ordered in the app and paid by card (the article's FIRST line), then beer sold on the fiche (unpaid). The arrival
// SAS leaves the complement unpaid, so the check-out recalls it.
function recalledStay() {
  const id = stay(3);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(todayIso(), id);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1' }).status, 200);
  assert.equal(extraSale.sell(id, requests, { now }).status, 200);
  withNow(at(id, '17:00'), () => reservations.commitArrivalSas(id, { complementItems: [] }));
  assert.equal(cents(row(id).complementAmount), 3000);
  const [paid, unpaid] = beerLines(id).map((line) => line.lineId);
  return { id, paid, unpaid, refs: [{ kind: 'option', id: beer }, { kind: 'option', id: beer, lineId: unpaid }] };
}

test('rule 107 d — the check-out offering the card-paid line: 409 OVERPAID naming it, nothing written; confirmed: offered, 30 € owed back, Σ unchanged', () => {
  const { id, refs } = recalledStay();
  const leave = at(id, '10:00', 3);
  const before = { row: row(id), lines: beerLines(id), owed: owed(id), balanced: balanced(id) };
  assert.throws(() => withNow(leave, () => reservations.commitDepartureSas(id, { offeredArrivalExtras: refs })), (err) => {
    assert.deepEqual([err.refusal.status, err.refusal.body.code, err.refusal.body.overpaymentTtc], [409, 'OVERPAID', 30]);
    assert.deepEqual(err.refusal.body.overpaymentKeys, [`option:${beer}`], 'the paid line, by the recap key; the unpaid one is not named');
    return true;
  });
  assert.deepEqual([row(id), beerLines(id), owed(id)], [before.row, before.lines, before.owed], 'nothing written');

  withNow(leave, () => reservations.commitDepartureSas(id, { offeredArrivalExtras: refs, forceOverpayment: true }));
  assert.deepEqual(beerLines(id).map((line) => line.offered), [1, 1]);
  assert.deepEqual([owed(id), balanced(id)], [3000, before.balanced]);
});

test('rule 107 d — the arrival 409 names the paid line it offered (`overpaymentKeys`), never a line already offered', () => {
  const id = stay(3);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(todayIso(), id);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1' }).status, 200);
  assert.throws(() => withNow(at(id, '17:00'), () => reservations.commitArrivalSas(id, { complementItems: [], offeredExtras: [{ kind: 'option', id: beer }] })), (err) => {
    assert.deepEqual([err.refusal.body.code, err.refusal.body.overpaymentKeys], ['OVERPAID', [`option:${beer}`]]);
    return true;
  });
});

test('rule 107 d — the SAS controller answers both refusals as 409 with their body and records no SAS history; confirmed, both commits go through', { skip: skipWithout(['sas']) }, () => {
  const { id, refs } = recalledStay();
  const arrivalHistory = history(id, 'sas_arrival');
  const leave = at(id, '10:00', 3);
  const refused = withNow(leave, () => call('commitDeparture', id, { offeredArrivalExtras: refs }));
  assert.equal(refused.statusCode, 409);
  assert.deepEqual([refused.body.code, refused.body.overpaymentTtc, refused.body.overpaymentKeys], ['OVERPAID', 30, [`option:${beer}`]]);
  assert.deepEqual([history(id, 'sas_departure'), row(id).departureSasDoneAt, owed(id)], [0, null, 0], 'no history, nothing written');
  const forced = withNow(leave, () => call('commitDeparture', id, { offeredArrivalExtras: refs, forceOverpayment: true }));
  assert.equal(forced.statusCode, 200, JSON.stringify(forced.body));
  assert.equal(owed(id), 3000);
  assert.equal(history(id, 'sas_arrival'), arrivalHistory);

  const other = stay(3);
  const now = at(other, '12:00', -3);
  assert.equal(ctrl.performUpdate(other, { ...storedBody(other), restatePricing: true }, { now }).status, 200);
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(todayIso(), other);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(other, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(other, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-2' }, orderRef: 'order:2' }).status, 200);
  const door = at(other, '17:00');
  const arrival = withNow(door, () => call('commitArrival', other, { offered: [{ kind: 'option', id: beer }] }));
  assert.equal(arrival.statusCode, 409, JSON.stringify(arrival.body));
  assert.deepEqual([arrival.body.code, arrival.body.overpaymentKeys], ['OVERPAID', [`option:${beer}`]]);
  assert.deepEqual([history(other, 'sas_arrival'), row(other).arrivalSasDoneAt], [0, null], 'no history, nothing written');
  const confirmed = withNow(door, () => call('commitArrival', other, { offered: [{ kind: 'option', id: beer }], forceOverpayment: true }));
  assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
  assert.equal(owed(other), 3000);
});
