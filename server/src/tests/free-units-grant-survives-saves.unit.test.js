// specs/tariff-recipes/spec.md §3 rule 66 (adversarial review of the 2026-10-27 spec-review fixes) —
// the free units a stay was GRANTED survive every save: removing the option, lowering its quantity or
// moving the stay to a platform for a while must not erase the grant, and re-adding the option must
// not bill it. Driven through the real reservations controller.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');

// 3 nights × 100 € + « Ménage » 80 € per stay with 1 unit included in the rate on property 1.
function setGrant(units) {
  f.seed();
  f.db.prepare('INSERT OR REPLACE INTO property_option_prices (optionId, propertyId, price, freeUnits) VALUES (50, 1, 80, ?)').run(units);
}
const snap = (id) => JSON.parse(f.rowOf(id).tariffSnapshot);
let month = 0;
const stay = (options) => {
  month += 1;
  const m = String(month).padStart(2, '0');
  return f.createStay({ startDate: `2028-${m}-10`, endDate: `2028-${m}-13`, options });
};

test('removing the option then re-adding it keeps the grant (300 €, never 380 €)', async () => {
  setGrant(1);
  const id = stay([{ optionId: 50, quantity: 1 }]);
  assert.equal(f.rowOf(id).finalPrice, 300);
  assert.equal((await f.save(id, { options: [] })).statusCode, 200);
  assert.deepEqual(snap(id).grantedFreeUnitsByOption, { 50: 1 }, 'the grant outlives its line');
  assert.deepEqual(snap(id).freeUnitsByOption, {}, 'nothing is consumed without the line');
  assert.equal((await f.save(id, { options: [{ optionId: 50, quantity: 1 }] })).statusCode, 200);
  assert.equal(f.rowOf(id).finalPrice, 300);
});

test('lowering the quantity then raising it back bills nothing more', async () => {
  setGrant(2);
  const id = stay([{ optionId: 50, quantity: 2 }]);
  assert.equal(f.rowOf(id).finalPrice, 300);
  await f.save(id, { options: [{ optionId: 50, quantity: 1 }] });
  assert.equal(f.rowOf(id).finalPrice, 300);
  assert.deepEqual(snap(id).grantedFreeUnitsByOption, { 50: 2 });
  assert.deepEqual(snap(id).freeUnitsByOption, { 50: 1 });
  await f.save(id, { options: [{ optionId: 50, quantity: 2 }] });
  assert.equal(f.rowOf(id).finalPrice, 300);
});

test('a stay moved to a platform and back gets its grant back', async () => {
  setGrant(1);
  const id = stay([{ optionId: 50, quantity: 1 }]);
  await f.save(id, { platform: 'Booking' });
  assert.deepEqual(snap(id).grantedFreeUnitsByOption, { 50: 1 }, 'a platform consumes nothing but keeps the grant');
  assert.deepEqual(snap(id).freeUnitsByOption, {});
  await f.save(id, { platform: 'direct' });
  assert.equal(f.rowOf(id).finalPrice, 300);
});

test('a catalogue widened after the sale does not reach the stay; a newly added option gets it', async () => {
  setGrant(1);
  const id = stay([{ optionId: 50, quantity: 2 }]);
  assert.equal(f.rowOf(id).finalPrice, 380);
  setGrant(2);
  await f.save(id, { notes: 'widened' });
  assert.equal(f.rowOf(id).finalPrice, 380, 'sold with 1 free unit, still 1');

  const other = stay([]);
  await f.save(other, { options: [{ optionId: 50, quantity: 2 }] });
  assert.equal(f.rowOf(other).finalPrice, 300, 'an option new to the stay is granted today\'s catalogue');
  assert.deepEqual(snap(other).grantedFreeUnitsByOption, { 50: 2 });
});

test('an option sold with no grant keeps « none » when the catalogue later grants one', async () => {
  setGrant(0);
  const id = stay([{ optionId: 50, quantity: 1 }]);
  assert.deepEqual(snap(id).grantedFreeUnitsByOption, { 50: 0 }, '0 is an answer, stored explicitly');
  setGrant(1);
  await f.save(id, { options: [] });
  await f.save(id, { options: [{ optionId: 50, quantity: 1 }] });
  assert.equal(f.rowOf(id).finalPrice, 380);
});

test('a snapshot written before rule 66 reads its consumed map as the grant', async () => {
  setGrant(1);
  const id = stay([{ optionId: 50, quantity: 1 }]);
  const legacy = snap(id);
  delete legacy.grantedFreeUnitsByOption;
  f.db.prepare('UPDATE reservations SET tariffSnapshot = ? WHERE id = ?').run(JSON.stringify(legacy), id);
  await f.save(id, { options: [] });
  assert.deepEqual(snap(id).grantedFreeUnitsByOption, { 50: 1 }, 'converted at the first save');
  await f.save(id, { options: [{ optionId: 50, quantity: 1 }] });
  assert.equal(f.rowOf(id).finalPrice, 300);
});
