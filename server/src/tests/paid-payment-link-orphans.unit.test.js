// specs/plugins-phase-3a-online-payment.md rule 27 — the boot counts the paid links left without a stay
// and deletes nothing (audit 2026-10-28).
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const db = require('../database');
const { countOrphanPaidLinks } = require('../utils/paidPaymentLinks');

const link = (reservationId, status, paidAt = null) => db.prepare(
  "INSERT INTO payment_links (reservationId, type, status, paidAt, amountCents) VALUES (?, 'deposit', ?, ?, 100)",
).run(reservationId, status, paidAt);

test('rule 27 - orphan paid links are counted, never deleted', () => {
  const before = countOrphanPaidLinks(db);
  link(999001, 'paid');
  link(999002, 'open');
  assert.equal(countOrphanPaidLinks(db), before + 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_links WHERE reservationId IN (999001, 999002)').get().n, 2);
});

test('rule 27 - a link retired after the guest paid it (cancelled + paidAt) counts as paid', () => {
  const before = countOrphanPaidLinks(db);
  link(999003, 'cancelled', '2026-10-01T10:00:00Z');
  assert.equal(countOrphanPaidLinks(db), before + 1);
});

test('rule 27 - a schema without payment_links is tolerated', () => {
  assert.equal(countOrphanPaidLinks(new Database(':memory:')), 0);
});
