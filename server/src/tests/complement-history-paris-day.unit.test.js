// specs/finance-dashboard-redesign.md rule 50 — the history window of a collected complement starts on the Paris
// day it was collected: an edit stamped `2026-10-30 23:30:00` (UTC) was made at 00:30 on 31/10 and counts when
// the complement was collected on 31/10.
process.env.TZ = 'Europe/Paris';
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const AT_HALF_PAST_MIDNIGHT = '2026-10-30 23:30:00';

function collectedOn31(changes) {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  if (!db.prepare('SELECT 1 FROM properties WHERE id = 1').get()) {
    db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (1, 'Gîte', 8, 0)").run();
    db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
  }
  const id = db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice, complementPaid, complementPaidDate, complementAmount)
    VALUES (1, 1, '2026-10-29', '2026-11-02', 'direct', 2, 300, 1, '2026-10-31', 42)`).run().lastInsertRowid;
  db.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields, createdAt) VALUES (?, 'update', ?, ?)")
    .run(id, JSON.stringify(changes), AT_HALF_PAST_MIDNIGHT);
  // Collected before the stamp existed: the collected tax is only in the history.
  db.prepare('UPDATE reservations SET complementCollectedTax = NULL WHERE id = ?').run(id);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  return { controller, id, row };
}

test('rule 50 — an option dropped at 00:30 on the collection day counts in the complement excess', () => {
  const { controller, id, row } = collectedOn31([{ field: 'optionsSignature', from: '3:1:30.00:c1', to: '' }]);
  assert.equal(controller.__test.complementLeftOf(id, { complementDetailLines: [] }, row).options, 30);
});

test('rule 50 — the tourist tax a legacy complement collected is read from an edit at 00:30 on the collection day', () => {
  const { controller, id, row } = collectedOn31([{ field: 'touristTaxTotal', from: 12, to: 6 }]);
  assert.equal(row.complementCollectedTax, null);
  const left = controller.__test.complementLeftOf(id, { complementDetailLines: [], touristTaxInComplement: true, touristTaxTotal: 6 }, row);
  assert.equal(left.touristTax, 6);
});
