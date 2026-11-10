// specs/reservation-payment-ledger.md rule 70 (audit R38-DB-L1, R38-C-L1) — the SAS writes the caution under the PATCH's
// rules 12 and 14: the departure SAS never returns a caution that was never received, and the arrival SAS's « non reçue »
// clears the return with the receipt. The cancelled fiche's due return reads « À rendre ».
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
require('../../sdk/registry').configure({ isActive: () => true, allows: () => true });
const sas = require('../controller');
const reservationsModel = require('../../../models/reservationsModel');
const { buildLedger } = require('../../../utils/reservationLedger');
const { getTodayIsoDate } = require('../../../utils/reservationHelpers');

const TODAY = getTodayIsoDate();
db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled, defaultCautionAmount) VALUES (1, 'Gîte', 8, 0, 300)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();

function leavingToday({ received }) {
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice,
      balanceAmount, balancePaid, balancePaidDate, cautionAmount, cautionReceived, cautionReceivedDate, checkInDone, arrivalSasDoneAt)
    VALUES (1, 1, date(?, '-4 day'), ?, 'direct', 2, 500, 500, 1, date(?, '-10 day'), 300, ?, ?, 1, date(?, '-4 day'))`)
    .run(TODAY, TODAY, TODAY, received ? 1 : 0, received ? TODAY : null, TODAY).lastInsertRowid);
}

const commitDeparture = (id, body) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  sas.commitDeparture({ params: { id: String(id) }, body, user: { role: 'admin' } }, res);
  return res;
};
const caution = (id) => db.prepare(`SELECT cautionReceived AS received, cautionReceivedDate AS receivedOn,
  cautionReturned AS returned, cautionReturnedDate AS returnedOn, departureSasDoneAt AS done FROM reservations WHERE id = ?`).get(id);

test('rule 70: the departure SAS refuses to return a caution never received, nothing written', () => {
  const id = leavingToday({ received: false });
  const res = commitDeparture(id, { cautionReturned: true });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'CAUTION_NOT_RECEIVED');
  assert.deepEqual(caution(id), { received: 0, receivedOn: null, returned: 0, returnedOn: null, done: null });
});

test('rule 70: the departure SAS still returns a received caution', () => {
  const id = leavingToday({ received: true });
  const res = commitDeparture(id, { cautionReturned: true, complementsSettled: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const c = caution(id);
  assert.equal(c.returned, 1);
  assert.equal(c.returnedOn, TODAY);
});

test('rule 70: the arrival SAS « non reçue » clears the return with the receipt, as the PATCH does (rule 14)', () => {
  const id = leavingToday({ received: true });
  db.prepare('UPDATE reservations SET cautionReturned = 1, cautionReturnedDate = ? WHERE id = ?').run(TODAY, id);
  reservationsModel.commitArrivalSas(id, { cautionReceived: false });
  const c = caution(id);
  assert.deepEqual([c.received, c.receivedOn, c.returned, c.returnedOn], [0, null, 0, null]);
});

test('rule 70 (R38-C-L1): the due return reads « À rendre » on a cancelled stay, « À rendre au départ » on a live one', () => {
  const live = leavingToday({ received: true });
  const cancelled = leavingToday({ received: true });
  db.prepare("UPDATE reservations SET kind = 'cancelled', cancelledAt = datetime('now') WHERE id = ?").run(cancelled);
  const label = (id) => buildLedger({ row: reservationsModel.getRow(id), cautionAmount: 300, today: TODAY })
    .rows.find((r) => r.key === 'cautionReturned').stateLabel;
  assert.equal(label(live), 'À rendre au départ');
  assert.equal(label(cancelled), 'À rendre');
});
