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

test('rule 12: an absent field keeps the policy default, nothing else is silently replaced', async () => {
  const db = freshDb();
  seedProperty(db, { id: 1, name: 'Le Gîte' });
  const model = propertiesModelModule.buildModel(db);
  await model.update(1, { name: 'Le Gîte' });
  const row = db.prepare('SELECT depositDueDays, balanceDaysBefore, cancelAfterBalanceDueDays FROM properties WHERE id = 1').get();
  assert.deepEqual({ ...row }, { depositDueDays: 7, balanceDaysBefore: 30, cancelAfterBalanceDueDays: 7 });

  await model.update(1, { name: 'Le Gîte', depositDueDays: 0, balanceDaysBefore: '0', cancelAfterBalanceDueDays: 60 });
  const kept = db.prepare('SELECT depositDueDays, balanceDaysBefore, cancelAfterBalanceDueDays FROM properties WHERE id = 1').get();
  assert.deepEqual({ ...kept }, { depositDueDays: 0, balanceDaysBefore: 0, cancelAfterBalanceDueDays: 60 });
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
