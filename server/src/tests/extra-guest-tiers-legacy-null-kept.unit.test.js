// specs/tariff-recipes/spec.md §3 rule 67 (adversarial review of the 2026-10-27 spec-review fixes) —
// a save replays the tier table the stay was sold under and stores it VERBATIM: a legacy `null`
// (a Lodge stay sold at ≤ 2 guests before the fix, found by the operator's SQL) stays `null`, an
// explicit `[]` stays `[]`, a sold table stays that table.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');

const tiersOf = (id) => f.db
  .prepare("SELECT json_type(tariffSnapshot, '$.extraGuestTiers') AS t, json_extract(tariffSnapshot, '$.extraGuestTiers') AS v FROM reservations WHERE id = ?")
  .get(id);

function withStoredTiers(id, tiers) {
  const snap = JSON.parse(f.rowOf(id).tariffSnapshot);
  snap.extraGuestTiers = tiers;
  f.db.prepare('UPDATE reservations SET tariffSnapshot = ? WHERE id = ?').run(JSON.stringify(snap), id);
}

test('a legacy null tier table stays null through a save', async () => {
  const id = f.createStay({ startDate: f.inDays(180), endDate: f.inDays(183) });
  withStoredTiers(id, null);
  assert.equal((await f.save(id, { notes: 'y' })).statusCode, 200);
  assert.equal(tiersOf(id).t, 'null');
  assert.equal((await f.save(id, { adults: 3 })).statusCode, 200);
  assert.equal(tiersOf(id).t, 'null', 'a party change replays « no tiers » and keeps saying so');
});

test('an explicit [] and a sold table are kept as they were', async () => {
  const empty = f.createStay({ startDate: f.inDays(189), endDate: f.inDays(192) });
  assert.equal(tiersOf(empty).v, '[]');
  await f.save(empty, { notes: 'x' });
  assert.equal(tiersOf(empty).v, '[]');

  const sold = f.createStay({ startDate: f.inDays(199), endDate: f.inDays(202) });
  const table = [{ fromNight: 1, price: 15 }, { fromNight: 2, price: 8 }];
  withStoredTiers(sold, table);
  await f.save(sold, { notes: 'x' });
  assert.deepEqual(JSON.parse(tiersOf(sold).v), table);
});
