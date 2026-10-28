// specs/plugins-phase-3a-online-payment.md rule 27 — a stay or a devis carrying a paid online payment
// cannot be deleted, and the boot counts the paid links already left without a stay (audit 2026-10-28).
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const db = require('../database');
const { hasPaidLink, countOrphanPaidLinks } = require('../utils/paidPaymentLinks');
const devisModel = require('../models/devisModel');
const reservationsController = require('../controllers/reservationsController');

function stay(kind) {
  const property = db.prepare('SELECT id FROM properties LIMIT 1').get() || { id: db.prepare("INSERT INTO properties (name) VALUES ('P')").run().lastInsertRowid };
  const client = db.prepare('SELECT id FROM clients LIMIT 1').get() || { id: db.prepare("INSERT INTO clients (firstName, lastName) VALUES ('A', 'B')").run().lastInsertRowid };
  return Number(db.prepare("INSERT INTO reservations (propertyId, clientId, startDate, endDate, kind) VALUES (?, ?, '2099-01-01', '2099-01-03', ?)").run(property.id, client.id, kind).lastInsertRowid);
}
const link = (reservationId, status, paidAt = null) => db.prepare(
  "INSERT INTO payment_links (reservationId, type, status, paidAt, amountCents) VALUES (?, 'deposit', ?, ?, 100)",
).run(reservationId, status, paidAt);

function call(controller, id) {
  const out = {};
  controller({ params: { id: String(id) }, query: {}, headers: {}, user: { role: 'admin' } }, {
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; },
  });
  return out;
}

test('a stay with a paid link is not deleted; an open link does not block', () => {
  const paid = stay('reservation');
  link(paid, 'paid');
  const refused = call(reservationsController.remove, paid);
  assert.equal(refused.status, 409);
  assert.ok(db.prepare('SELECT 1 FROM reservations WHERE id = ?').get(paid));

  const open = stay('reservation');
  link(open, 'open');
  assert.equal(call(reservationsController.remove, open).body.ok, true);
  assert.equal(db.prepare('SELECT 1 FROM reservations WHERE id = ?').get(open), undefined);
});

test('a link retired after the guest paid it (cancelled + paidAt) still counts as money', () => {
  const id = stay('reservation');
  link(id, 'cancelled', '2026-10-01T10:00:00Z');
  assert.equal(hasPaidLink(db, id), true);
  assert.equal(call(reservationsController.remove, id).status, 409);
});

test('a devis with a paid link is not deleted', () => {
  const id = stay('devis');
  link(id, 'paid');
  const result = devisModel.remove(id);
  assert.equal(result.status, 409);
  assert.ok(db.prepare('SELECT 1 FROM reservations WHERE id = ?').get(id));
});

test('orphan paid links are counted, never deleted', () => {
  const before = countOrphanPaidLinks(db);
  link(999001, 'paid');
  link(999002, 'open');
  assert.equal(countOrphanPaidLinks(db), before + 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_links WHERE reservationId IN (999001, 999002)').get().n, 2);
});

test('a schema without payment_links is tolerated', () => {
  const bare = new Database(':memory:');
  assert.equal(hasPaidLink(bare, 1), false);
  assert.equal(countOrphanPaidLinks(bare), 0);
});
