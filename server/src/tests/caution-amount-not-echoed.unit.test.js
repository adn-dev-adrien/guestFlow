// specs/caution-live-from-property.md rule 9 (spec review 2026-10-27) — the save never writes the
// caution amount: the fiche shows the live property amount, and echoing it back made a phantom history
// row and locked every started stay once the property's default had moved.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');

const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

test('a started stay saves unchanged after the property caution moved', async () => {
  f.seed();
  const id = f.createStay({ startDate: isoDay(-3), endDate: isoDay(4), unlockPast: true });
  f.db.prepare('UPDATE reservations SET cautionAmount = 500 WHERE id = ?').run(id);
  f.db.prepare('UPDATE properties SET defaultCautionAmount = 300 WHERE id = 1').run();
  const res = await f.save(id, {});
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  f.db.prepare('UPDATE properties SET defaultCautionAmount = 500 WHERE id = 1').run();
});

test('the first save of a stay created without caution writes no « Caution 0 € → 500 € »', async () => {
  const id = f.createStay({ startDate: f.inDays(300), endDate: f.inDays(302) });
  assert.equal(f.rowOf(id).cautionAmount, 0);
  assert.equal(f.getFiche(id).cautionAmount, 500);
  assert.equal((await f.save(id, { notes: 'Vu' })).statusCode, 200);
  const fields = f.history(id).flatMap((h) => h.changes.map((c) => c.field));
  assert.ok(!fields.includes('cautionAmount'), JSON.stringify(fields));
});
