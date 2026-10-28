// specs/force-item-to-complement.md rule 18 (spec review 2026-10-27) — a stay created with a line
// routed to the complement stores that complement, and the boot repair restores the rows that lost it.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const { runCreatedComplementRepair } = require('../utils/createdComplementRepair');

test('POST stores the complement of a line routed to it', () => {
  const id = f.createStay({ startDate: '2027-06-01', endDate: '2027-06-04', options: [{ optionId: 50, quantity: 1, inComplement: 1 }] });
  const row = f.rowOf(id);
  assert.equal(row.complementAmount, 80);
  assert.equal(Math.round((row.finalPrice - row.depositAmount - row.balanceAmount) * 100) / 100, 80);
});

test('the repair restores a row that lost its complement at creation, and only that row', () => {
  const lost = f.createStay({ startDate: '2027-06-10', endDate: '2027-06-13', options: [{ optionId: 50, quantity: 1, inComplement: 1 }] });
  const saved = f.createStay({ startDate: '2027-06-20', endDate: '2027-06-23', options: [{ optionId: 50, quantity: 1, inComplement: 1 }] });
  const paid = f.createStay({ startDate: '2027-06-25', endDate: '2027-06-27', options: [{ optionId: 50, quantity: 1, inComplement: 1 }] });
  const plain = f.createStay({ startDate: '2027-07-01', endDate: '2027-07-03' });
  f.db.prepare('UPDATE reservations SET complementAmount = 0 WHERE id IN (?, ?, ?)').run(lost, saved, paid);
  f.db.prepare('UPDATE reservations SET complementPaid = 1 WHERE id = ?').run(paid);
  f.db.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, 'update', '[]')").run(saved);

  const { repaired } = runCreatedComplementRepair(f.db);
  assert.deepEqual(repaired.map((r) => r.id), [lost]);
  assert.equal(f.rowOf(lost).complementAmount, 80);
  assert.equal(f.rowOf(saved).complementAmount, 0);
  assert.equal(f.rowOf(paid).complementAmount, 0);
  assert.equal(f.rowOf(plain).complementAmount, 0);
  const trace = f.history(lost).pop();
  assert.equal(trace.changes[0].field, 'complementAmount');
  assert.equal(runCreatedComplementRepair(f.db).repaired.length, 0, 'idempotent');
});

test('the repair leaves a row whose totals do not prove the gap', () => {
  const id = f.createStay({ startDate: '2027-07-10', endDate: '2027-07-13', options: [{ optionId: 50, quantity: 1, inComplement: 1 }] });
  f.db.prepare('UPDATE reservations SET complementAmount = 0, balanceAmount = balanceAmount + 80 WHERE id = ?').run(id);
  assert.equal(runCreatedComplementRepair(f.db).repaired.length, 0);
});
