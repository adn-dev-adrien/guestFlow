// Review amendments: rule 45 — what is written is what was validated; absent keeps the stored value.
// specs/settings-input-guards.md rules 9-14 — the three payment delays of a property.

const test = require('node:test');
const assert = require('node:assert/strict');

const { validatePropertyInput } = require('../utils/propertyValidation');
const { freshDb, seedProperty } = require('./guestEmailSequenceFixtures');
const propertiesModelModule = require('../models/propertiesModel');

const on = { depositEnabled: true };

test('rule 9: depositDueDays is a whole number from 0 to 30 when the acompte is on', () => {
  for (const ok of [0, 7, 30, '0', '30']) {
    assert.deepEqual(validatePropertyInput({ ...on, depositDueDays: ok }), {}, String(ok));
  }
  for (const bad of [-1, '-3', 31, '45', 2.5, 'abc']) {
    assert.ok(validatePropertyInput({ ...on, depositDueDays: bad }).depositDueDays, String(bad));
  }
  assert.equal(validatePropertyInput({ ...on, depositDueDays: 31 }).depositDueDays, 'Entre 0 et 30 jours.');
  assert.equal(validatePropertyInput({ ...on, depositDueDays: 2.5 }).depositDueDays, 'Nombre entier de jours.');
  assert.equal(validatePropertyInput({ ...on, depositDueDays: 'abc' }).depositDueDays, 'Nombre attendu.');
});

test('rule 9: with the acompte off, the hidden depositDueDays is not validated', () => {
  assert.deepEqual(validatePropertyInput({ depositEnabled: false, depositDueDays: -3 }), {});
  assert.deepEqual(validatePropertyInput({ depositEnabled: '0', depositDueDays: 400 }), {});
});

test('rule 10: balanceDaysBefore and cancelAfterBalanceDueDays run from 0 to 60, acompte on or off', () => {
  for (const key of ['balanceDaysBefore', 'cancelAfterBalanceDueDays']) {
    for (const body of [{}, on]) {
      assert.deepEqual(validatePropertyInput({ ...body, [key]: 0 }), {});
      assert.deepEqual(validatePropertyInput({ ...body, [key]: 60 }), {});
      assert.equal(validatePropertyInput({ ...body, [key]: 61 })[key], 'Entre 0 et 60 jours.');
      assert.equal(validatePropertyInput({ ...body, [key]: -1 })[key], 'Entre 0 et 60 jours.');
      assert.equal(validatePropertyInput({ ...body, [key]: 1.5 })[key], 'Nombre entier de jours.');
    }
  }
});

test('rule 11: a stored out-of-range value stays savable until the field is touched', () => {
  const existing = { depositEnabled: 1, depositDueDays: 7, balanceDaysBefore: 90, cancelAfterBalanceDueDays: 7 };
  assert.deepEqual(validatePropertyInput({ depositEnabled: 1, balanceDaysBefore: '90', name: 'Le Gîte' }, existing), {});
  assert.equal(validatePropertyInput({ balanceDaysBefore: 91 }, existing).balanceDaysBefore, 'Entre 0 et 60 jours.');
  assert.deepEqual(validatePropertyInput({ balanceDaysBefore: 45 }, existing), {});
});

test('rule 11: the check runs on creation', () => {
  assert.ok(validatePropertyInput({ name: 'Nouveau', balanceDaysBefore: 90 }, null).balanceDaysBefore);
});

test('rule 11: the acompte switched on in the same edit makes the stored delay checked only if it changed', () => {
  const existing = { depositEnabled: 0, depositDueDays: 90 };
  assert.deepEqual(validatePropertyInput({ depositEnabled: true, depositDueDays: 90 }, existing), {});
  assert.ok(validatePropertyInput({ depositEnabled: true, depositDueDays: 40 }, existing).depositDueDays);
});

const delays = (db) => ({ ...db.prepare('SELECT depositDueDays, balanceDaysBefore, cancelAfterBalanceDueDays FROM properties WHERE id = 1').get() });
async function property(stored) {
  const db = freshDb();
  seedProperty(db, { id: 1, name: 'Le Gîte', ...stored });
  return { db, model: propertiesModelModule.buildModel(db) };
}

test('rule 12: an absent or empty delay on update keeps the STORED value, never the policy default', async () => {
  const { db, model } = await property({ depositDueDays: 12, balanceDaysBefore: 45, cancelAfterBalanceDueDays: 3, depositEnabled: 1 });
  await model.update(1, { name: 'Le Gîte', depositEnabled: true });
  assert.deepEqual(delays(db), { depositDueDays: 12, balanceDaysBefore: 45, cancelAfterBalanceDueDays: 3 });
  await model.update(1, { name: 'Le Gîte', depositEnabled: true, depositDueDays: '', balanceDaysBefore: null });
  assert.deepEqual(delays(db), { depositDueDays: 12, balanceDaysBefore: 45, cancelAfterBalanceDueDays: 3 });
});

test('rule 12: a creation without the fields gets the policy defaults', async () => {
  const db = freshDb();
  const id = (await propertiesModelModule.buildModel(db).create({ name: 'Neuf' })).id;
  const row = db.prepare('SELECT depositDueDays, balanceDaysBefore, cancelAfterBalanceDueDays FROM properties WHERE id = ?').get(id);
  assert.deepEqual({ ...row }, { depositDueDays: 7, balanceDaysBefore: 30, cancelAfterBalanceDueDays: 7 });
});

test('rule 12: what is written is the value the validator accepted — « 45,0 » and 0 included', async () => {
  const { db, model } = await property({});
  const body = { name: 'Le Gîte', depositEnabled: true, depositDueDays: '0', balanceDaysBefore: '45,0', cancelAfterBalanceDueDays: 60 };
  assert.deepEqual(validatePropertyInput(body, null), {});
  await model.update(1, body);
  assert.deepEqual(delays(db), { depositDueDays: 0, balanceDaysBefore: 45, cancelAfterBalanceDueDays: 60 });
});

test('rule 12: with the acompte off the hidden delay is neither validated nor overwritten — the stored one stays', async () => {
  const { db, model } = await property({ depositDueDays: 12, depositEnabled: 0 });
  for (const hidden of [-5, 400, 'abc']) {
    await model.update(1, { name: 'Le Gîte', depositEnabled: false, depositDueDays: hidden });
    assert.equal(delays(db).depositDueDays, 12, String(hidden));
  }
});

test('rule 11, 12: a hidden 400 is not stored, so a later « unchanged » skip cannot let it through', async () => {
  const { db, model } = await property({ depositEnabled: 0 });
  await model.update(1, { name: 'Le Gîte', depositEnabled: false, depositDueDays: 400 });
  assert.equal(delays(db).depositDueDays, 7, 'the hidden 400 was not stored');
  assert.ok(validatePropertyInput({ depositEnabled: true, depositDueDays: 400 }, { depositEnabled: 0, depositDueDays: 7 }).depositDueDays);
});

test('rule 12: a refused payload is refused as a whole, one message per field', () => {
  const errors = validatePropertyInput({ ...on, depositDueDays: -5, balanceDaysBefore: 400, cancelAfterBalanceDueDays: 'x' });
  assert.deepEqual(Object.keys(errors).sort(), ['balanceDaysBefore', 'cancelAfterBalanceDueDays', 'depositDueDays']);
});

test('rule 13: the acompte percent keeps its own rule and message', () => {
  assert.deepEqual(validatePropertyInput({ ...on, depositPercent: 30 }), {});
  assert.deepEqual(validatePropertyInput({ ...on, depositPercent: '12,5' }), {});
  assert.match(validatePropertyInput({ ...on, depositPercent: 100 }).depositPercent, /^Entre 1 et 99 %\./);
  assert.match(validatePropertyInput({ ...on, depositPercent: 0 }).depositPercent, /^Entre 1 et 99 %\./);
});
