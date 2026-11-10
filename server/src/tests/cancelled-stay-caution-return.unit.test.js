// specs/payment-schedule-and-cancellation.md rule 59 (audit R37-RES-L1) — a caution received and still held when the
// stay is cancelled is given back on the cancelled fiche: PATCH /payment takes `cautionReturned` (and its date) alone
// on a cancelled stay, judged as on a live one (rule 12: never before the receipt); the ledger offers « Restituer »;
// once returned, the stay's client and logement are deletable again. Any other write on the cancelled stay is still
// 409 RESERVATION_CANCELLED, nothing written.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const clientsModel = require('../models/clientsModel');
const propertiesModel = require('../models/propertiesModel');
const { CAUTION_MESSAGES } = require('../utils/deletionGuard');
const { buildLedger } = require('../utils/reservationLedger');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const TODAY = todayIso();

test.before(() => f.seed());

function patch(id, body) {
  const res = f.respond();
  f.controller.updatePayment({ user: f.ADMIN, params: { id: String(id) }, query: {}, body }, res);
  return res;
}

/** A future stay whose caution was received yesterday, then cancelled: the caution is still held. */
function cancelledWithCaution() {
  const id = f.createStay();
  assert.equal(patch(id, { cautionReceived: true, cautionReceivedDate: addDaysToIsoDate(TODAY, -1) }).statusCode, 200);
  f.db.prepare("UPDATE reservations SET kind = 'cancelled', cancelledAt = datetime('now') WHERE id = ?").run(id);
  return id;
}

const caution = (id) => {
  const r = f.rowOf(id);
  return { received: Number(r.cautionReceived), returned: Number(r.cautionReturned), returnedOn: r.cautionReturnedDate };
};

test('rule 59: the caution held on a cancelled stay is marked returned, dated today when no date is sent', () => {
  const id = cancelledWithCaution();
  const res = patch(id, { cautionReturned: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(caution(id), { received: 1, returned: 1, returnedOn: TODAY });
});

test('rule 59: once returned, the client and the logement are no longer held by it', () => {
  const id = cancelledWithCaution();
  const { clientId, propertyId } = f.rowOf(id);
  assert.equal(clientsModel.create(f.db).deletionBlocker(clientId), CAUTION_MESSAGES.client);
  assert.equal(patch(id, { cautionReturned: true, cautionReturnedDate: TODAY }).statusCode, 200);
  assert.notEqual(clientsModel.create(f.db).deletionBlocker(clientId), CAUTION_MESSAGES.client);
  assert.notEqual(propertiesModel.buildModel(f.db).deletionBlocker(propertyId), CAUTION_MESSAGES.property);
});

test('rule 59: a return dated before the receipt is refused as on a live stay, nothing written', () => {
  const id = cancelledWithCaution();
  const res = patch(id, { cautionReturned: true, cautionReturnedDate: addDaysToIsoDate(TODAY, -3) });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'INVALID_PAYMENT_DATE');
  assert.deepEqual(caution(id), { received: 1, returned: 0, returnedOn: null });
});

test('rule 59: every other write on the cancelled stay is still refused, nothing written', () => {
  const id = cancelledWithCaution();
  for (const body of [
    { cautionReturned: true, depositPaid: true },
    { cautionReceived: false },
    { depositPaid: true },
    { cautionReturned: false },
  ]) {
    const res = patch(id, body);
    assert.equal(res.statusCode, 409, `${JSON.stringify(body)}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, 'RESERVATION_CANCELLED');
  }
  assert.deepEqual(caution(id), { received: 1, returned: 0, returnedOn: null });
  assert.equal(Number(f.rowOf(id).depositPaid || 0), 0);
  assert.equal(patch(id, { cautionReturned: true }).statusCode, 200);
  const again = patch(id, { cautionReturned: true });
  assert.equal(again.statusCode, 409, 'returned already: nothing left to give back');
});

test('rule 59: a cancelled stay that never received a caution takes no return', () => {
  const id = f.createStay();
  f.db.prepare("UPDATE reservations SET kind = 'cancelled', cancelledAt = datetime('now') WHERE id = ?").run(id);
  const res = patch(id, { cautionReturned: true });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'RESERVATION_CANCELLED');
});

test('rule 59: the cancelled fiche\'s ledger offers « Restituer » on a held caution', () => {
  const id = cancelledWithCaution();
  const row = f.rowOf(id);
  const ledger = buildLedger({ row, cautionAmount: 300, today: TODAY });
  const returned = ledger.rows.find((r) => r.key === 'cautionReturned');
  assert.equal(returned.action && returned.action.label, 'Restituer');
});
