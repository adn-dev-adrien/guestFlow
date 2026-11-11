// specs/reservation-save-keeps-pricing.md rule 17 — audit R3 N3: once a save has rewritten the stored lines, the
// complement excess a removed activity left is still booked on « Activités », read from the history since the
// complement was collected.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

test('rule 17 — a resource removed after the complement was collected is read from the history', () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (1, 'Gîte', 8, 0)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
  const id = db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice, complementPaid, complementPaidDate, complementAmount)
                         VALUES (1, 1, '2099-03-01', '2099-03-04', 'direct', 2, 300, 1, '2099-02-01', 80)`).run().lastInsertRowid;
  db.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields, createdAt) VALUES (?, 'update', ?, '2099-02-10 10:00:00')")
    .run(id, JSON.stringify([{ field: 'resourcesSignature', from: '7:1:80', to: '' }]));
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const left = controller.__test.complementLeftOf(id, { complementDetailLines: [] }, row);
  assert.equal(left.resources, 80);
  assert.equal(left.options, 0);

  const { overpaymentLinesOf } = require('../utils/overpayment');
  const lines = overpaymentLinesOf({
    row: { depositPaid: 0, balancePaid: 1 }, capturedByPoste: {},
    quote: { finalPrice: 300, optionsTotal: 24, resourcesTotal: 0, touristTaxTotal: 0, complementCollectedExcessTtc: 80 },
    overpaymentTtc: 80, complementLeft: left,
  });
  assert.deepEqual(lines.map((l) => [l.bucket, l.amountTtc]), [['resources', 80]]);
});

test('rule 17 — a solde option removed in the same window is not counted again on the complement (audit R3 review, minor 1)', () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  const { overpaymentLinesOf } = require('../utils/overpayment');
  const id = db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice, balancePaid, balancePaidDate, complementPaid, complementPaidDate, complementAmount)
                         VALUES (1, 1, '2099-04-01', '2099-04-04', 'direct', 2, 300, 1, '2099-01-15', 1, '2099-02-01', 80)`).run().lastInsertRowid;
  db.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields, createdAt) VALUES (?, 'update', ?, '2099-02-10 10:00:00')")
    .run(id, JSON.stringify([{ field: 'resourcesSignature', from: '7:1:80', to: '' }, { field: 'optionsSignature', from: '3:1:32|4:1:24', to: '4:1:24' }]));
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const left = controller.__test.complementLeftOf(id, { complementDetailLines: [] }, row);
  const lines = overpaymentLinesOf({
    row: { depositPaid: 0, balancePaid: 1 }, capturedByPoste: {},
    quote: { finalPrice: 300, optionsTotal: 24, resourcesTotal: 0, touristTaxTotal: 0, complementCollectedExcessTtc: 80 },
    overpaymentTtc: 112, complementLeft: left, leftover: { options: 32, resources: 80 },
  });
  assert.deepEqual(lines.map((l) => [l.bucket, l.amountTtc]).sort(), [['options', 32], ['resources', 80]]);
});

test('rule 17 — a paid complement with no paid date reads no history (audit R3 review, minor 2)', () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  const id = db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice, complementPaid, complementAmount)
                         VALUES (1, 1, '2099-05-01', '2099-05-04', 'direct', 2, 300, 1, 80)`).run().lastInsertRowid;
  db.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields, createdAt) VALUES (?, 'update', ?, '2090-02-10 10:00:00')")
    .run(id, JSON.stringify([{ field: 'resourcesSignature', from: '7:1:80', to: '' }]));
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  assert.equal(controller.__test.complementLeftOf(id, { complementDetailLines: [] }, row).resources, 0);
});

// Audit R3 re-check — the history window of the complement overlaps the schedule's; only the overflow is taken back.
function splitOf(history, { cx, total, leftover, captured, quote, paidDate = '2099-02-01' }) {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  const { overpaymentLinesOf } = require('../utils/overpayment');
  const id = db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice, balancePaid, balancePaidDate, complementPaid, complementPaidDate, complementAmount)
                         VALUES (1, 1, '2099-06-01', '2099-06-04', 'direct', 2, 300, 1, '2099-01-15', 1, ?, 80)`).run(paidDate).lastInsertRowid;
  for (const [day, changes] of history) {
    db.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields, createdAt) VALUES (?, 'update', ?, ?)").run(id, JSON.stringify(changes), day);
  }
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const left = controller.__test.complementLeftOf(id, { complementDetailLines: [] }, row);
  const lines = overpaymentLinesOf({
    row: { depositPaid: 0, balancePaid: 1 }, capturedByPoste: captured || {},
    quote: { finalPrice: 300, optionsTotal: 24, resourcesTotal: 0, touristTaxTotal: 0, complementCollectedExcessTtc: cx, ...(quote || {}) },
    overpaymentTtc: total, complementLeft: left, leftover,
  });
  return lines.map((l) => [l.bucket, l.amountTtc]).sort();
}
const SOLDE_OPTION_AND_ACTIVITY = [['2099-02-10 10:00:00', [
  { field: 'resourcesSignature', from: '7:1:80', to: '' }, { field: 'optionsSignature', from: '3:1:32|4:1:24', to: '4:1:24' },
]]];

test('rule 17 — case A: an option dropped before and another after the collection, none left on the stay, both land on options', () => {
  const history = [
    ['2099-01-20 10:00:00', [{ field: 'optionsSignature', from: '3:1:32|5:1:28', to: '5:1:28' }]],
    ['2099-02-10 10:00:00', [{ field: 'optionsSignature', from: '5:1:28', to: '' }]],
  ];
  assert.deepEqual(splitOf(history, { cx: 28, total: 60, leftover: { options: 60 }, quote: { optionsTotal: 0, resourcesTotal: 50 } }), [['options', 60]]);
});

test('rule 17 — case D: with captured contribs the solde option is not counted again on the complement', () => {
  assert.deepEqual(splitOf(SOLDE_OPTION_AND_ACTIVITY, {
    cx: 80, total: 112, leftover: { options: 32 },
    captured: { balance: { accommodation: 220, options: 56, resources: 0, touristTax: 0 } },
  }), [['options', 32], ['resources', 80]]);
});

test('rule 17 — cases n3mix, original, C and E keep their split', () => {
  assert.deepEqual(splitOf(SOLDE_OPTION_AND_ACTIVITY, { cx: 80, total: 112, leftover: { options: 32 } }), [['options', 32], ['resources', 80]]);
  const activity = [['2099-02-10 10:00:00', [{ field: 'resourcesSignature', from: '7:1:80', to: '' }]]];
  assert.deepEqual(splitOf(activity, { cx: 80, total: 80, leftover: {} }), [['resources', 80]]);
  const optionThenActivity = [
    ['2099-01-20 10:00:00', [{ field: 'optionsSignature', from: '3:1:32|4:1:24', to: '4:1:24' }]],
    ['2099-02-10 10:00:00', [{ field: 'resourcesSignature', from: '7:1:80', to: '' }]],
  ];
  assert.deepEqual(splitOf(optionThenActivity, { cx: 80, total: 112, leftover: { options: 32 } }), [['options', 32], ['resources', 80]]);
  assert.deepEqual(splitOf(activity, { cx: 80, total: 80, leftover: {}, paidDate: null })[0][0], 'options', 'no paid date: no history, the options poste takes the unexplained rest');
});

test('rule 17 — case B: same as A with an option left on the stay', () => {
  const history = [
    ['2099-01-20 10:00:00', [{ field: 'optionsSignature', from: '3:1:32|5:1:28|4:1:24', to: '5:1:28|4:1:24' }]],
    ['2099-02-10 10:00:00', [{ field: 'optionsSignature', from: '5:1:28|4:1:24', to: '4:1:24' }]],
  ];
  assert.deepEqual(splitOf(history, { cx: 28, total: 60, leftover: { options: 60 } }), [['options', 60]]);
});
