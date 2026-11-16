// specs/reception-role-checkin-only.md rule 18 (loop t7 A7-1) — at the SAS a reception-only account never sees the amount a paid line would owe
// back and cannot force it: the 409 names no amount, `forceOverpayment` is dropped, nothing is written. The admin flow is unchanged.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, stay, row, beer, addDaysToIsoDate,
} = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');
const { toReceptionSasCommit } = require('../utils/receptionView');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const sasController = optionalPlugin(() => require('../plugins/sas/controller'));
const SAS = { skip: skipWithout(['sas']) };
const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
const offeredOf = (id) => db.prepare('SELECT offered FROM reservation_options WHERE reservationId = ? AND optionId = ?').all(id, beer).map((r) => Number(r.offered));
const respond = () => ({
  statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; },
});
const RECEPTION = { id: 2, roles: ['reception'] };
const ADMIN = { id: 1, roles: ['admin'] };

function paidBeerStay() {
  const id = stay(0);
  db.prepare('UPDATE reservations SET checkInTime = ?, checkInDone = 0 WHERE id = ?').run('00:01', id);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(addDaysToIsoDate(row(id).startDate, -3), id);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, {
    now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1',
  }).status, 200);
  return id;
}

const commit = (id, user, extra = {}) => {
  const res = respond();
  sasController.commitArrival({ params: { id: String(id) }, body: { offered: [{ kind: 'option', id: beer }], complementSettled: false, ...extra }, user }, res);
  return res;
};

test('toReceptionSasCommit drops forceOverpayment and keeps the rest', () => {
  assert.deepEqual(toReceptionSasCommit({ forceOverpayment: true, cautionReceived: true }), { cautionReceived: true });
});

test('reception: the 409 on a paid line names no amount, forcing it is still refused, nothing is written', SAS, () => {
  const id = paidBeerStay();
  const first = commit(id, RECEPTION);
  assert.equal(first.statusCode, 409);
  assert.equal(first.body.code, 'OVERPAID');
  assert.equal('overpaymentTtc' in first.body, false);
  assert.doesNotMatch(JSON.stringify(first.body), /\d/);
  const forced = commit(id, RECEPTION, { forceOverpayment: true });
  assert.equal(forced.statusCode, 409);
  assert.equal('overpaymentTtc' in forced.body, false);
  assert.equal(owed(id), 0);
  assert.deepEqual(offeredOf(id).filter((v) => v === 1), []);
});

test('admin: the same commit answers the amount, and forcing it opens the refund obligation', SAS, () => {
  const id = paidBeerStay();
  const first = commit(id, ADMIN);
  assert.equal(first.statusCode, 409);
  assert.equal(first.body.overpaymentTtc, 30);
  const forced = commit(id, ADMIN, { forceOverpayment: true });
  assert.equal(forced.statusCode, 200);
  assert.equal(owed(id), 3000);
});
