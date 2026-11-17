// specs/pricing-components.md §3 rule 122 (stabilisation loop t9, S9-1, 2026-11-16) — the arrival SAS writes only the arrival complement, so it
// never lets the engine take money out of it that the engine now routes to another bucket. A direct stay whose solde was paid holds 20 € in its
// arrival complement (the stay grew past the paid solde); the solde is un-marked from the fiche: the engine of today puts those 20 € in the unpaid
// solde (300 €) and leaves the complement at 0. The SAS validated with nothing changed must keep the stored complement (20 €) — before, it wrote
// the engine's 0, the solde stayed at 280 €, and 20 € vanished from what the stay asks (stay 22336: 60,40 €, the tourist tax).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const ctrl = require('../controllers/reservationsController');
const model = require('../models/reservationsModel');
const { withNow } = require('../utils/localDate');
const { storedBody } = require('../utils/stayOrderLines');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const registry = require('../plugins/sdk/registry');
const sas = optionalPlugin(() => require('../plugins/sas/controller'));

registry.configure({ isActive: () => true, allows: () => true });

const ADMIN = { id: 1, roles: ['admin'] };
const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (v) => Math.round(Number(v || 0) * 100);
// Σ buckets − total: what the stay asks or received beyond its price. A commit that changes nothing never moves it.
const sigma = (id) => {
  const r = row(id);
  return cents(r.depositAmount) + cents(r.balanceAmount) + cents(r.complementAmount) + cents(r.endOfStayComplementAmount) - cents(r.finalPrice) - cents(r.touristTaxTotal);
};
const asked = (id) => {
  const r = row(id);
  return (Number(r.balancePaid) ? 0 : cents(r.balanceAmount)) + (Number(r.complementPaid) ? 0 : cents(r.complementAmount));
};
const respond = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const callSas = (fn, id, body) => { const res = respond(); sas[fn]({ params: { id: String(id) }, body, user: ADMIN, query: {} }, res); return res; };

// 300 € stay, solde paid at 280 €, the 20 € the stay grew since in the arrival complement; then the solde un-marked from the fiche.
function soldeUnmarked() {
  const id = stay(3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now: at(id, '12:00', -3) }).status, 200);
  db.prepare("UPDATE reservations SET depositAmount = 0, balanceAmount = 280, balancePaid = 1, balancePaidDate = date('now'), complementAmount = 20 WHERE id = ?").run(id);
  const res = respond();
  withNow(at(id, '12:00', -1), () => ctrl.updatePayment({ params: { id: String(id) }, body: { balancePaid: false }, query: {}, user: ADMIN }, res));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual([row(id).balancePaid, cents(row(id).balanceAmount), cents(row(id).complementAmount)], [0, 28000, 2000]);
  return id;
}

test('S9-1 — the arrival SAS validated with nothing changed keeps the complement the engine routes to the unpaid solde: Σ and what is asked unchanged', { skip: skipWithout(['sas']) }, () => {
  const id = soldeUnmarked();
  const before = { sigma: sigma(id), asked: asked(id) };
  assert.equal(before.asked, 30000);
  const door = at(id, '15:00');
  const recap = withNow(door, () => callSas('previewArrival', id, {})).body;
  assert.equal(cents(recap.arrivalComplementTotal), 2000, 'the preview names the stored complement');
  const done = withNow(door, () => callSas('commitArrival', id, {}));
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.deepEqual([cents(row(id).complementAmount), cents(row(id).balanceAmount)], [2000, 28000]);
  assert.deepEqual({ sigma: sigma(id), asked: asked(id) }, before);
  const again = withNow(door, () => callSas('commitArrival', id, {}));
  assert.equal(again.statusCode, 200, JSON.stringify(again.body));
  assert.equal(cents(row(id).complementAmount), 2000, 'a re-run keeps it too');
});

test('rule 122 — the gap is carried only when the engine’s buckets hold the same sum: a stored complement nothing explains still takes the engine’s (rule 90.1)', () => {
  const id = stay(3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now: at(id, '12:00', -3) }).status, 200);
  db.prepare('UPDATE reservations SET complementAmount = 30 WHERE id = ?').run(id);
  const written = withNow(at(id, '15:00'), () => model.commitArrivalSas(id, { complementItems: [] }));
  assert.equal(written, 0);
  assert.equal(cents(row(id).complementAmount), 0);
});
