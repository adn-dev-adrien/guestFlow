// specs/disable-deposit-per-reservation.md rule 11 (adversarial review of the 2026-10-27 spec-review
// fixes) — a row stored before rule 10 with a 0 € acompte AND a deadline reads « no deadline » on both
// sides of a save, so a past locked fiche still saves and an unlocked one writes no phantom history
// row; the boot cleanup clears those deadlines where nothing was paid on the acompte.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const { runZeroDepositDeadlineCleanup } = require('../utils/zeroDepositDeadlineCleanup');

function legacyZeroAcompte(over = {}) {
  const res = f.create({ ...f.stayBody({ depositDisabled: 1, ...over }), unlockPast: true });
  assert.equal(res.statusCode, 200);
  const id = Number(res.body.id);
  f.db.prepare("UPDATE reservations SET depositDueDate = '2026-08-01' WHERE id = ?").run(id);
  assert.equal(f.rowOf(id).depositAmount, 0);
  return id;
}

test('a PAST locked fiche with a legacy 0 € acompte deadline still saves', async () => {
  const id = legacyZeroAcompte({ startDate: '2026-09-01', endDate: '2026-09-04' });
  const res = await f.save(id, {});
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal((await f.save(id, { discountPercent: 5 })).statusCode, 200);
});

test('an unlocked fiche writes no « Date acompte … → — » history row', async () => {
  const id = legacyZeroAcompte({ startDate: '2027-09-01', endDate: '2027-09-04' });
  const before = f.history(id).length;
  assert.equal((await f.save(id, {})).statusCode, 200);
  const fields = f.history(id).slice(before).flatMap((h) => h.changes.map((c) => c.field));
  assert.ok(!fields.includes('depositDueDate'), `phantom deadline change: ${JSON.stringify(fields)}`);
});

test('the boot cleanup clears the deadline of unpaid 0 € acomptes only', () => {
  const zero = legacyZeroAcompte({ startDate: '2027-11-01', endDate: '2027-11-04' });
  const paidZero = legacyZeroAcompte({ startDate: '2027-11-10', endDate: '2027-11-13' });
  f.db.prepare("UPDATE reservations SET depositPaid = 1, depositPaidDate = '2027-08-01' WHERE id = ?").run(paidZero);
  const withAcompte = f.createStay({ startDate: '2027-11-20', endDate: '2027-11-23' });
  const deadline = f.rowOf(withAcompte).depositDueDate;
  assert.ok(deadline);

  const cleared = runZeroDepositDeadlineCleanup(f.db);
  assert.ok(cleared >= 1);
  assert.equal(f.rowOf(zero).depositDueDate, null);
  assert.equal(f.rowOf(paidZero).depositDueDate, '2026-08-01', 'something recorded on the acompte: left alone');
  assert.equal(f.rowOf(withAcompte).depositDueDate, deadline);
  assert.equal(runZeroDepositDeadlineCleanup(f.db), 0, 'idempotent');
});
