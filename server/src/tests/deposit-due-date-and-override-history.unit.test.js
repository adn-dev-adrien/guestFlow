// Spec review 2026-10-27 — the acompte's deadline and its hand-typed amount:
//   - specs/disable-deposit-per-reservation.md rule 10: an acompte at 0 € carries no deadline;
//   - specs/reservation-history-granular-diff.md rule 13: setting / clearing the typed acompte is a
//     labelled history row;
//   - specs/editable-deposit-amount.md rule 9: a negative acompte is refused in French.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');

test('switching the acompte off clears its deadline', async () => {
  const id = f.createStay({ startDate: '2027-10-01', endDate: '2027-10-04' });
  assert.ok(f.rowOf(id).depositDueDate);
  assert.equal((await f.save(id, { depositDisabled: 1 })).statusCode, 200);
  const row = f.rowOf(id);
  assert.equal(row.depositAmount, 0);
  assert.equal(row.depositDueDate, null);
  const fields = f.history(id).flatMap((h) => h.changes.map((c) => c.field));
  assert.ok(fields.includes('depositDueDate'));
});

test('an acompte created at 0 € stores no deadline', () => {
  const id = f.createStay({ startDate: '2027-10-10', endDate: '2027-10-13', depositDisabled: 1, depositDueDate: '2026-11-03' });
  assert.equal(f.rowOf(id).depositDueDate, null);
});

test('setting then clearing the typed acompte each leave an « Acompte saisi » row', async () => {
  const id = f.createStay({ startDate: '2027-10-20', endDate: '2027-10-23' });
  assert.equal((await f.save(id, { depositAmountOverride: 50 })).statusCode, 200);
  assert.equal((await f.save(id, { depositAmountOverride: '' })).statusCode, 200);
  const rows = f.history(id).flatMap((h) => h.changes).filter((c) => c.field === 'depositAmountOverride');
  assert.deepEqual(rows.map((c) => [c.label, c.from, c.to]), [['Acompte saisi', null, 50], ['Acompte saisi', 50, null]]);
});

test('a plain re-save writes no « Acompte saisi » row', async () => {
  const id = f.createStay({ startDate: '2027-11-01', endDate: '2027-11-03', depositAmountOverride: 40 });
  assert.equal((await f.save(id, { notes: 'x' })).statusCode, 200);
  const rows = f.history(id).flatMap((h) => h.changes).filter((c) => c.field === 'depositAmountOverride');
  assert.equal(rows.length, 0);
});

test('a negative acompte is refused with a French message and the code', async () => {
  const id = f.createStay({ startDate: '2027-11-10', endDate: '2027-11-12' });
  const res = await f.save(id, { depositAmountOverride: -10 });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'NEGATIVE_AMOUNT');
  assert.match(res.body.error, /négatif/);
});
