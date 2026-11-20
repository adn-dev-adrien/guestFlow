// specs/pricing-components.md §3 rule 48 (stabilisation loop t5, D5-6, 2026-11-16) — the read is never late: `stayRepository.lineFacts`
// rebuilds a stay a write behind the hooks left marked before it sums a line's allocations, like `paymentLedger.allocations`. Before, the
// stay was quoted with its stale per-line `settledCents` until another reader flushed it.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, fiche, forced, pay, NO_ACOMPTE, S, C,
} = require('./moneyLedgerFixture');

const dirty = (id) => db.prepare('SELECT COUNT(*) AS n FROM payment_allocations_dirty WHERE reservationId = ?').get(id).n;
const lineFacts = (id) => require('../models/ports/stayRepository').create(db).lineFacts(id);

test('D5-6 — a payment taken back behind the hooks: the line facts no longer carry it, and the mark is gone', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(id, S, C);
  assert.equal(lineFacts(id)['custom:forcée'].settledCents, 5000, 'the hooked payment is on the line');
  db.prepare('UPDATE reservations SET complementPaid = 0, complementPaidDate = NULL WHERE id = ?').run(id);
  assert.equal(dirty(id), 1, 'the trigger marked the stay');
  assert.equal(lineFacts(id)['custom:forcée'].settledCents, 0, 'the line reads the statement, not the stale rows');
  assert.equal(dirty(id), 0);
});
