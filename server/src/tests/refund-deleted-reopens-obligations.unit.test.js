// specs/pricing-components.md rules 75, 98 (loop t1 B-5) — a refund on the trop-perçu settles the `lineLowered` rows it covers, the part it took of a row as a
// settled row of its own; deleting that refund opens them again, so the register owes what the trop-perçu owes.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const obligations = require('../models/refundObligationsModel');

db.prepare("INSERT INTO properties (id, name) VALUES (9901, 'B5')").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9901, 'Test', 'B5')").run();
const stay = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, kind, finalPrice, totalPrice)
  VALUES (9901, 9901, date('now', '+20 day'), date('now', '+23 day'), 'reservation', 300, 300)`).run().lastInsertRowid);
const open = () => db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS n FROM refund_obligations WHERE reservationId = ? AND status = 'open'").get(stay).n;

test('B-5 — a partial refund settles its part as a row of its own; deleted, the 10 € are owed again', () => {
  obligations.open({ reservationId: stay, origin: 'lineLowered', amountCents: 1000, reason: 'ligne payée baissée' });
  obligations.settleLoweredBy(stay, 7, 600);
  assert.equal(open(), 400);
  assert.equal(db.prepare("SELECT amountCents FROM refund_obligations WHERE reservationId = ? AND settledBy = 'refund:7'").get(stay).amountCents, 600);
  assert.equal(obligations.reopenSettledBy(stay, 7), 1);
  assert.equal(open(), 1000);
  assert.equal(obligations.reopenSettledBy(stay, 7), 0, 'once');
});
