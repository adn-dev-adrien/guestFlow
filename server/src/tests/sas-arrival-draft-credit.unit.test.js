// specs/pricing/pricing-components.md §3 rule 104 e (stabilisation loop t6, unverified note of the ui-process review, 2026-11-16) — the arrival recap of a
// DRAFT lists the stored rule-104 credit only for the part that explains why the draft's complement is below its listed lines: a draft that offers
// the basket the credit sat on asks 0 € and lists no « Déjà réglé −10 € », so the lines always sum to the complement asked.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const reservationsModel = require('../models/reservationsModel');
const { storedBody } = require('../utils/stayOrderLines');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const { shapeArrivalRecap } = optionalPlugin(() => require('../plugins/sas/arrivalRecap'));

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const patch = (id, body) => ctrl.updatePayment({ params: { id: String(id) }, body, query: {}, user: { id: 1, role: 'admin' } }, { status() { return this; }, json() { return this; } });
const sum = (lines) => Math.round(lines.reduce((s, l) => s + Number(l.billed || 0), 0) * 100);

test('rule 104 e — the draft recap\'s lines sum to its complement, the stored credit cut to what the draft still explains', { skip: skipWithout(['sas']) }, () => {
  const id = stay(20);
  ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
  extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }], { now: at(id, '12:00', -3) });
  patch(id, { balancePaid: true, balancePaidDate: todayIso() });
  patch(id, { checkInDone: true });
  const sold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at(id, '12:00', 1), payment: 'cash' });
  const ref = sold.saleDetail.lines.find((l) => l.articleKey === `option:${beer}`).ref;
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 10 } }, { now: at(id, '13:00', 1) }).status, 200);
  const { credits } = extraSale.saleDetailOf(id);
  const basket = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(id);

  const plain = shapeArrivalRecap(reservationsModel.planArrivalSas(id, {}), { credits });
  assert.equal(plain.arrivalComplementTotal, 35);
  assert.deepEqual(plain.lines.filter((l) => l.kind === 'credit').map((l) => l.billed), [-10]);
  assert.equal(sum(plain.lines), 3500);

  const offered = shapeArrivalRecap(reservationsModel.planArrivalSas(id, { offeredExtras: [{ kind: 'custom', id: Number(basket.id) }] }), { credits });
  assert.equal(offered.arrivalComplementTotal, 0);
  assert.equal(offered.lines.some((l) => l.kind === 'credit'), false);
  assert.equal(sum(offered.lines), 0);
});
