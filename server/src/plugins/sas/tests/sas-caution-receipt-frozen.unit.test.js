// specs/reservation-payment-ledger.md rule 71 (audit R39-DB-L1 / R39-M-L1, 2026-11-10) — the arrival SAS obeys rule 38
// on the caution: a caution already received is never received again. The SAS's « Caution perçue » freezes the
// property's caution only on the flip from not received to received (caution-live-from-property rule 2); on a caution
// already received (a stale SAS tab after « Caution reçue » on the fiche, a replayed or crafted request) it writes
// nothing, so the collected amount never follows a later change of the property's default.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
require('../../sdk/registry').configure({ isActive: () => true, allows: () => true });
const sas = require('../controller');
const reservationsModel = require('../../../models/reservationsModel');
const { getTodayIsoDate } = require('../../../utils/reservationHelpers');

const TODAY = getTodayIsoDate();
db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled, defaultCautionAmount) VALUES (1, 'Gîte', 8, 0, 500)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();

function arrivingToday() {
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice,
      balanceAmount, balancePaid, balancePaidDate, cautionAmount)
    VALUES (1, 1, ?, date(?, '+3 day'), 'direct', 2, 500, 500, 1, date(?, '-10 day'), 500)`)
    .run(TODAY, TODAY, TODAY).lastInsertRowid);
}
const setDefault = (amount) => db.prepare('UPDATE properties SET defaultCautionAmount = ? WHERE id = 1').run(amount);
const caution = (id) => db.prepare(`SELECT cautionAmount AS amount, cautionReceived AS received, cautionReceivedDate AS receivedOn,
  cautionReturned AS returned, cautionReturnedDate AS returnedOn FROM reservations WHERE id = ?`).get(id);
const commitArrival = (id, body) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  sas.commitArrival({ params: { id: String(id) }, body, user: { id: 1, roles: ['admin'] }, query: {} }, res);
  return res;
};

test('rule 71 (R39-DB-L1 repro): a caution received at 500 stays at 500 when a stale arrival SAS commits after the default moved to 700', () => {
  setDefault(500);
  const id = arrivingToday();
  db.prepare('UPDATE reservations SET cautionReceived = 1, cautionReceivedDate = date(?, \'-1 day\') WHERE id = ?').run(TODAY, id);
  const before = caution(id);
  setDefault(700);
  const res = commitArrival(id, { cautionReceived: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(caution(id), before);
  assert.equal(caution(id).amount, 500);
});

test('rule 71: a caution received and returned keeps its amount, receipt and return through the SAS receipt', () => {
  setDefault(400);
  const id = arrivingToday();
  db.prepare('UPDATE reservations SET cautionAmount = 400, cautionReceived = 1, cautionReceivedDate = ?, cautionReturned = 1, cautionReturnedDate = ? WHERE id = ?')
    .run(TODAY, TODAY, id);
  const before = caution(id);
  setDefault(450);
  reservationsModel.commitArrivalSas(id, { cautionReceived: true });
  assert.deepEqual(caution(id), before);
});

test('rule 71: the flip from not received to received still freezes the property caution of that moment, dated today', () => {
  setDefault(500);
  const id = arrivingToday();
  setDefault(650);
  const res = commitArrival(id, { cautionReceived: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(caution(id), { amount: 650, received: 1, receivedOn: TODAY, returned: 0, returnedOn: null });
  setDefault(800);
  commitArrival(id, { cautionReceived: true });
  assert.equal(caution(id).amount, 650, 'a re-opened SAS that answers « perçue » again moves nothing');
});
