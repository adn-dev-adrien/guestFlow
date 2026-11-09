// specs/mixed-method-payments.md rule 45 (audit R34-A1) — reception records a check-out with one method: the SAS read
// tells the dialog not to offer « Plusieurs moyens », and crafted lines are refused with a French message, nothing
// recorded (never dropped: they carry the caisse-interne share).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
require('../../sdk/registry').configure({ isActive: () => true, allows: () => true });
const sas = require('../controller');
const settlements = require('../../../models/paymentSettlementsModel');
const { getTodayIsoDate } = require('../../../utils/reservationHelpers');

const TODAY = getTodayIsoDate();
const ADMIN = { roles: ['admin'] };
const RECEPTION = { roles: ['reception'] };
db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (1, 'Gîte', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();

function leavingToday() {
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice,
      balanceAmount, balancePaid, balancePaidDate, endOfStayComplementAmount, endOfStayComplementDetail, checkInDone, arrivalSasDoneAt)
    VALUES (1, 1, date(?, '-4 day'), ?, 'direct', 2, 500, 500, 1, date(?, '-10 day'), 122, ?, 1, date(?, '-4 day'))`)
    .run(TODAY, TODAY, TODAY, JSON.stringify([{ key: 'custom:menage', label: 'Ménage', amount: 122 }]), TODAY).lastInsertRowid);
}
const respond = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

test('specs/mixed-method-payments.md rule 45 — the SAS read offers the split to the admin only', () => {
  const id = leavingToday();
  for (const [user, expected] of [[ADMIN, true], [RECEPTION, false]]) {
    const res = respond();
    sas.getSas({ params: { id: String(id) }, query: { mode: 'departure' }, user }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.canSplitPayment, expected);
  }
});

test('specs/mixed-method-payments.md rule 45 — reception sending lines: 403 in French, nothing recorded', () => {
  const id = leavingToday();
  const res = respond();
  sas.commitDeparture({
    params: { id: String(id) },
    body: {
      complementsSettled: true, displayedDepartureTotal: 122,
      complementsTenders: [{ method: 'cash', amountCents: 5000, internal: true }, { method: 'card', amountCents: 7200 }],
    },
    user: RECEPTION,
  }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.message, 'Plusieurs moyens : réservé à l\'administrateur.');
  assert.equal(db.prepare('SELECT endOfStayComplementPaid FROM reservations WHERE id = ?').get(id).endOfStayComplementPaid, 0);
  assert.equal(settlements.listFor(id).length, 0);
});
