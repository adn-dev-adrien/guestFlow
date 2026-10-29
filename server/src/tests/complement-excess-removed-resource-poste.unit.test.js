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
