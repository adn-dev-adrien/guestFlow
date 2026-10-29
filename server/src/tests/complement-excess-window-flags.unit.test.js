// specs/reservation-save-keeps-pricing.md rule 18 — audit R4 N5: the complement's history window counts only the
// lines that were in the complement (`:c1` in the signatures); a drop outside it belongs to the schedule.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

function stay({ balancePaid, history }) {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  if (!db.prepare('SELECT 1 FROM properties WHERE id = 1').get()) {
    db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (1, 'Gîte', 8, 0)").run();
    db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
  }
  const id = db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice, balancePaid, balancePaidDate, complementPaid, complementPaidDate, complementAmount)
    VALUES (1, 1, '2099-06-01', '2099-06-04', 'direct', 2, 300, ?, ?, 1, '2099-02-01', 30)`).run(balancePaid, balancePaid ? '2099-01-15' : null).lastInsertRowid;
  for (const [day, changes] of history) {
    db.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields, createdAt) VALUES (?, 'update', ?, ?)").run(id, JSON.stringify(changes), day);
  }
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  return { id, row, controller, left: controller.__test.complementLeftOf(id, { complementDetailLines: [] }, row) };
}

const { overpaymentLinesOf } = require('../utils/overpayment');
const quote = { finalPrice: 300, optionsTotal: 24, resourcesTotal: 0, touristTaxTotal: 0, complementCollectedExcessTtc: 30 };
const OPTION_OUT_OF_THE_SCHEDULE = ['2099-02-05 10:00:00', [{ field: 'optionsSignature', from: '3:1:50.00:c0|4:1:24.00:c0', to: '4:1:24.00:c0' }]];
const ACTIVITY_OUT_OF_THE_COMPLEMENT = ['2099-02-10 10:00:00', [{ field: 'resourcesSignature', from: '7:1:30.00:0:c1', to: '' }]];

test('rule 18 — X1: a solde option dropped from an unpaid solde does not take the complement activity\'s excess', () => {
  const { left } = stay({ balancePaid: 0, history: [OPTION_OUT_OF_THE_SCHEDULE, ACTIVITY_OUT_OF_THE_COMPLEMENT] });
  assert.equal(left.options, 0);
  assert.equal(left.resources, 30);
  const lines = overpaymentLinesOf({ row: { depositPaid: 0, balancePaid: 0 }, capturedByPoste: {}, quote, overpaymentTtc: 30, complementLeft: left });
  assert.deepEqual(lines.map((l) => [l.bucket, l.amountTtc]), [['resources', 30]]);
});

test('rule 18 — X2: a solde option excess already refunded does not take the complement activity\'s excess', () => {
  const { left } = stay({ balancePaid: 1, history: [OPTION_OUT_OF_THE_SCHEDULE, ACTIVITY_OUT_OF_THE_COMPLEMENT] });
  const lines = overpaymentLinesOf({
    row: { depositPaid: 0, balancePaid: 1 }, capturedByPoste: { balance: { accommodation: 226, options: 74, resources: 0, touristTax: 0 } },
    quote, overpaymentTtc: 30, complementLeft: left, leftover: { options: 50, resources: 30 },
  });
  assert.deepEqual(lines.map((l) => [l.bucket, l.amountTtc]), [['resources', 30]]);
});

test('rule 18 — an option dropped from the complement is still read from the history', () => {
  const { left } = stay({
    balancePaid: 1,
    history: [['2099-02-10 10:00:00', [{ field: 'optionsSignature', from: '3:1:30.00:c1|4:1:24.00:c0', to: '4:1:24.00:c0' }]]],
  });
  assert.equal(left.options, 30);
  assert.equal(left.resources, 0);
});

test('rule 18 — an option that only moved into the complement is not a drop', () => {
  const { left } = stay({
    balancePaid: 1,
    history: [['2099-02-10 10:00:00', [{ field: 'optionsSignature', from: '3:1:30.00:c0', to: '3:1:30.00:c1' }]]],
  });
  assert.equal(left.options, 0);
});
