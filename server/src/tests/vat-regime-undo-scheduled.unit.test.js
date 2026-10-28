// specs/vat-optional-mode.md rules 26 and 28 — a switch dated in the future is reversible: its target is
// compared with the LATEST period (not today's), and « Annuler ce changement » puts each reservation it
// moved back on the period it had, while the date is still ahead.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
const controller = require('../controllers/vatRegimeController');
const vatRegimeModel = require('../models/vatRegimeModel');
const switchModel = require('../models/vatRegimeSwitchModel');

const call = (fn, { body, params } = {}) => {
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  fn({ body, params, user: { id: 1 } }, res);
  return res;
};
const send = (input) => {
  const p = call(controller.preview, { body: input });
  return call(controller.makeSwitch, { body: { ...input, fingerprint: p.body && p.body.fingerprint, acknowledged: true } });
};
const periodOf = (id) => db.prepare('SELECT vatPeriodId FROM reservations WHERE id = ?').get(id).vatPeriodId;
const reset = () => {
  db.prepare('UPDATE reservations SET vatPeriodId = 1').run();
  db.prepare('DELETE FROM vat_periods WHERE id > 1').run();
  vatRegimeModel.syncMirror(db);
};
const FUTURE = { regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-12-01' };

test.beforeEach(reset);

test('rule 28: after a future-dated switch, the way back is offered, the same target is not', () => {
  const made = send(FUTURE);
  assert.equal(made.statusCode, 201);
  assert.ok(made.body.reassigned >= 1, 'the stays arriving after the date move at once');
  assert.equal(call(controller.preview, { body: { regime: 'subject', rate: 10, basis: 'all' } }).statusCode, 200, 'back to VAT');
  const again = call(controller.preview, { body: FUTURE });
  assert.equal(again.statusCode, 422);
  assert.equal(again.body.errors.regime, 'Régime déjà en vigueur');
  assert.equal(switchModel.readState(db).latest.regime, 'not_subject', 'the dialog builds its target from the latest period');
  assert.equal(switchModel.readState(db).inForce.regime, 'subject');
});

test('rule 26: the unstarted period is deletable although reservations moved, and undoing puts each one back', () => {
  send(FUTURE);
  const state = switchModel.readState(db);
  assert.equal(state.periods[0].deletable, true);
  assert.equal(state.periods[0].scheduled, true);
  assert.ok(state.periods[0].reservations >= 1);
  const moved = db.prepare('SELECT id FROM reservations WHERE vatPeriodId = ? ORDER BY id').all(state.periods[0].id).map((r) => r.id);
  assert.ok(moved.includes(105));
  const res = call(controller.remove, { params: { id: state.periods[0].id } });
  assert.equal(res.statusCode, 204);
  moved.forEach((id) => assert.equal(periodOf(id), 1, `reservation ${id} is back`));
  assert.equal(vatRegimeModel.listPeriods(db).length, 1);
});

test('rule 26: each reservation returns to the period it had BEFORE, not to the first one', () => {
  send({ regime: 'subject', rate: 12, basis: 'arrival', effectiveFrom: '2027-11-01' });
  const before105 = periodOf(105);
  const second = send({ regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-12-01' });
  assert.notEqual(periodOf(105), before105);
  assert.equal(call(controller.remove, { params: { id: second.body.period.id } }).statusCode, 204);
  assert.equal(periodOf(105), before105, 'back on the 12 % period, not on period 1');
  const first = vatRegimeModel.listPeriods(db)[1];
  assert.equal(call(controller.remove, { params: { id: first.id } }).statusCode, 204);
  assert.equal(periodOf(105), 1);
});

test('rule 26: a reservation born under the unstarted period falls to the period the others now give it', () => {
  const made = send(FUTURE).body.period;
  db.prepare("INSERT INTO reservations (kind, clientId, propertyId, startDate, endDate, finalPrice) VALUES ('reservation', 1, 1, '2028-01-10', '2028-01-12', 100)").run();
  const born = db.prepare('SELECT id, vatPeriodId FROM reservations ORDER BY id DESC LIMIT 1').get();
  assert.equal(born.vatPeriodId, made.id);
  assert.equal(call(controller.remove, { params: { id: made.id } }).statusCode, 204);
  assert.equal(periodOf(born.id), 1);
});

test('rule 26: the history says the change was cancelled, and the refund lines follow the restored rate', () => {
  const refund = Number(db.prepare("INSERT INTO reservation_refunds (reservationId, refundDate, method, totalTtc, reason) VALUES (105, '2027-10-01', 'transfer', 50, 'x')").run().lastInsertRowid);
  db.prepare("INSERT INTO reservation_refund_lines (refundId, lineKey, label, bucket, amountTtc, vatRate) VALUES (?, 'accommodation', 'Hébergement', 'accommodation', 50, 10)").run(refund);
  const made = send(FUTURE);
  assert.equal(made.statusCode, 201);
  assert.equal(db.prepare('SELECT vatRate FROM reservation_refund_lines WHERE refundId = ?').get(refund).vatRate, 0);
  assert.equal(call(controller.remove, { params: { id: made.body.period.id } }).statusCode, 204);
  assert.equal(db.prepare('SELECT vatRate FROM reservation_refund_lines WHERE refundId = ?').get(refund).vatRate, 10);
  const entry = JSON.parse(db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = 105 AND changedFields LIKE '%changement annulé%'").get().changedFields)[0];
  assert.equal(entry.toText.replace(/ du .*/, ''), 'Assujetti 10 % (changement annulé');
});

test('rule 26: once the date has come, a period that moved reservations stays (rule 18)', () => {
  const made = send(FUTURE).body.period;
  const today = '2027-12-02';
  assert.equal(switchModel.readState(db, { today }).periods[0].deletable, false);
  assert.equal(switchModel.deletePeriod(db, made.id, { today }).error, 'period_in_use');
  assert.equal(switchModel.deletePeriod(db, made.id).ok, true);
});
