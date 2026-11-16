// specs/pricing-components.md §3 rules 113 and 114 (stabilisation loop t8, S8-1 / S8-2, 2026-11-16) — the arrival SAS and a paid line, seen from
// the stay step. Rule 113: « Offert » unticked on the recap gives the solde back its credit (rule 109) INSIDE the commit, so the « Séjour à
// régler » the recap shows is the plan's — the acompte and the solde the commit leaves — and the commit marks paid exactly that; a recap read
// before the plan moved (`displayedStayDue`) is refused (409 STAY_DUE_CHANGED), nothing written. Before: shown 490,01, marked 535,01 (22303).
// Rule 114: the SAS offering a paid line credits its money to the solde not yet paid, as the line API does at the same hour — no 409, the solde
// lowered, nothing owed back. Before: 409 OVERPAID, forced → 45 € owed back while the unpaid solde was still asked in full (22303, 22306).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
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
const beerLine = (id) => db.prepare('SELECT lineId, offered FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, beer);
const call = (fn, id, body) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  sas[fn]({ params: { id: String(id) }, body, user: ADMIN, query: {} }, res);
  return res;
};

// A direct stay whose solde is not paid; a beer ordered in the app 3 days before and paid by card (30 €); `offered`: then offered by its action.
function cardLine({ offered }) {
  const id = stay(3);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1' }).status, 200);
  if (offered) {
    assert.equal(extraSale.changeLine(id, `option:${beerLine(id).lineId}`, { offered: true }, { now }).status, 200);
    assert.equal(owed(id), 0, 'the unpaid solde absorbed the credit');
  }
  return id;
}

test('S8-1 — « Offert » unticked at the arrival: the recap shows the solde the commit leaves (+30 €), the commit marks exactly that paid', { skip: skipWithout(['sas']) }, () => {
  const id = cardLine({ offered: true });
  const stored = cents(row(id).balanceAmount);
  const door = at(id, '15:00');
  const recap = withNow(door, () => call('previewArrival', id, { offered: [] })).body;
  assert.deepEqual([cents(recap.stayDue), cents(recap.stayPayment.total)], [stored + 3000, stored + 3000], 'the plan’s solde, not the stored one');
  assert.equal(row(id).balanceAmount, stored / 100, 'the preview writes nothing');
  const before = balanced(id);
  const done = withNow(door, () => call('commitArrival', id, { offered: [], stayPaid: true, displayedStayDue: recap.stayDue }));
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  const r = row(id);
  assert.deepEqual([r.balancePaid, cents(r.balanceAmount)], [1, cents(recap.stayDue)], 'marked paid = shown');
  assert.deepEqual([beerLine(id).offered, owed(id), balanced(id)], [0, 0, before]);
});

test('S8-1 — a recap read before the plan moved the solde: 409 STAY_DUE_CHANGED, nothing written', { skip: skipWithout(['sas']) }, () => {
  const id = cardLine({ offered: true });
  const stale = row(id).balanceAmount;
  const refused = withNow(at(id, '15:00'), () => call('commitArrival', id, { offered: [], stayPaid: true, displayedStayDue: stale }));
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'STAY_DUE_CHANGED');
  assert.equal(cents(refused.body.stayDue), cents(stale) + 3000);
  const r = row(id);
  assert.deepEqual([r.balancePaid, r.balanceAmount, r.arrivalSasDoneAt, beerLine(id).offered], [0, stale, null, 1]);
});

test('S8-1 — « Pas maintenant »: no figure to compare, the solde is asked again and left due', { skip: skipWithout(['sas']) }, () => {
  const id = cardLine({ offered: true });
  const stored = cents(row(id).balanceAmount);
  const done = withNow(at(id, '15:00'), () => call('commitArrival', id, { offered: [], stayPaid: false, displayedStayDue: stored / 100 }));
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.deepEqual([row(id).balancePaid, cents(row(id).balanceAmount)], [0, stored + 3000]);
});

test('S8-2 — the arrival SAS offering the paid line credits the unpaid solde like the line API at the same hour: no 409, nothing owed', { skip: skipWithout(['sas']) }, () => {
  const byApi = cardLine({ offered: false });
  const bySas = cardLine({ offered: false });
  const apiBefore = balanced(byApi);
  const sasBefore = balanced(bySas);
  const api = extraSale.changeLine(byApi, `option:${beerLine(byApi).lineId}`, { offered: true }, { now: at(byApi, '15:00') });
  assert.equal(api.status, 200, JSON.stringify(api.body));

  const door = at(bySas, '15:00');
  const recap = withNow(door, () => call('previewArrival', bySas, { offered: [{ kind: 'option', id: beer }] })).body;
  const done = withNow(door, () => call('commitArrival', bySas, { offered: [{ kind: 'option', id: beer }] }));
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.equal(beerLine(bySas).offered, 1);
  for (const field of ['balanceAmount', 'finalPrice', 'complementAmount', 'depositAmount']) assert.equal(row(bySas)[field], row(byApi)[field], field);
  assert.deepEqual([owed(bySas), owed(byApi)], [0, 0]);
  assert.equal(cents(recap.stayDue), cents(row(bySas).balanceAmount), 'the recap showed the lowered solde');
  assert.deepEqual([balanced(bySas), balanced(byApi)], [sasBefore, apiBefore]);
});
