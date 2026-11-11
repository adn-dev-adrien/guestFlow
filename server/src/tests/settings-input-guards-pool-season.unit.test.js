// Review amendments: rules 46-47 — a lone bound is completed from the stored season; the pair is judged on change.
// specs/settings-input-guards.md rules 22-27 — the pool season: off, all year, or a season.

const test = require('node:test');
const assert = require('node:assert/strict');

const { validatePropertyInput } = require('../utils/propertyValidation');
const { poolSeasonModeOf, resolvePoolSeason } = require('../utils/poolSeason');
const { freshDb, seedProperty } = require('./guestEmailSequenceFixtures');
const propertiesModelModule = require('../models/propertiesModel');
const { buildStayContent } = require('../utils/stayContentContext');

const poolOf = (db) => ({ ...db.prepare('SELECT poolSeasonStart AS s, poolSeasonEnd AS e FROM properties WHERE id = 1').get() });

async function saved(body) {
  const db = freshDb();
  seedProperty(db, { id: 1, name: 'Le Gîte' });
  const model = propertiesModelModule.buildModel(db);
  await model.update(1, { name: 'Le Gîte', ...body });
  return { db, model };
}

test('rule 23: « all year » is stored as 01-01 to 12-31', async () => {
  const { db } = await saved({ poolSeasonMode: 'allYear' });
  assert.deepEqual(poolOf(db), { s: '01-01', e: '12-31' });
});

test('rule 24: « none » empties both bounds, whatever dates came with it', async () => {
  const { db, model } = await saved({ poolSeasonMode: 'season', poolSeasonStart: '06-15', poolSeasonEnd: '08-31' });
  assert.deepEqual(poolOf(db), { s: '06-15', e: '08-31' });
  await model.update(1, { name: 'Le Gîte', poolSeasonMode: 'none', poolSeasonStart: '06-15', poolSeasonEnd: '08-31' });
  assert.deepEqual(poolOf(db), { s: '', e: '' });
});

test('rule 24: a payload with only the two dates keeps today\'s meaning', async () => {
  const { db } = await saved({ poolSeasonStart: '07-01', poolSeasonEnd: '08-31' });
  assert.deepEqual(poolOf(db), { s: '07-01', e: '08-31' });
  assert.deepEqual(resolvePoolSeason({ name: 'x' }), {}, 'a payload that says nothing leaves the pool alone');
});

test('rule 24: the mode is derived on read', async () => {
  assert.equal(poolSeasonModeOf('', ''), 'none');
  assert.equal(poolSeasonModeOf('01-01', '12-31'), 'allYear');
  assert.equal(poolSeasonModeOf('06-15', '08-31'), 'season');
  const { model } = await saved({ poolSeasonMode: 'allYear' });
  assert.equal(model.getByIdWithDetails(1).poolSeasonMode, 'allYear');
  const { model: m2 } = await saved({ poolSeasonStart: '06-15', poolSeasonEnd: '08-31' });
  assert.equal(m2.getByIdWithDetails(1).poolSeasonMode, 'season');
});

test('rule 25: the closing day is never before the opening day, equal bounds are a one-day season', () => {
  assert.equal(validatePropertyInput({ poolSeasonMode: 'season', poolSeasonStart: '10-01', poolSeasonEnd: '05-31' }).poolSeasonEnd,
    'La fermeture suit l\'ouverture.');
  assert.equal(validatePropertyInput({ poolSeasonStart: '10-01', poolSeasonEnd: '05-31' }).poolSeasonEnd,
    'La fermeture suit l\'ouverture.');
  assert.deepEqual(validatePropertyInput({ poolSeasonMode: 'season', poolSeasonStart: '06-15', poolSeasonEnd: '06-15' }), {});
  assert.deepEqual(validatePropertyInput({ poolSeasonMode: 'season', poolSeasonStart: '06-15', poolSeasonEnd: '08-31' }), {});
});

test('rule 26: a season with a missing bound is refused on the missing one', () => {
  assert.deepEqual(validatePropertyInput({ poolSeasonMode: 'season', poolSeasonStart: '06-15', poolSeasonEnd: '' }),
    { poolSeasonEnd: 'Les deux dates.' });
  assert.deepEqual(validatePropertyInput({ poolSeasonMode: 'season', poolSeasonStart: '', poolSeasonEnd: '08-31' }),
    { poolSeasonStart: 'Les deux dates.' });
  const both = validatePropertyInput({ poolSeasonMode: 'season', poolSeasonStart: '', poolSeasonEnd: '' });
  assert.equal(both.poolSeasonStart, 'Les deux dates.');
  assert.equal(both.poolSeasonEnd, 'Les deux dates.');
});

test('rule 26: the dates of « none » and « all year » are not checked, an unknown mode is refused', () => {
  assert.deepEqual(validatePropertyInput({ poolSeasonMode: 'allYear', poolSeasonStart: 'zz', poolSeasonEnd: '' }), {});
  assert.deepEqual(validatePropertyInput({ poolSeasonMode: 'none', poolSeasonStart: '06-15', poolSeasonEnd: '' }), {});
  assert.equal(validatePropertyInput({ poolSeasonMode: 'always' }).poolSeasonMode, 'Choix invalide.');
});

test('rule 27: switching the pool on and saving persists it (all year), a reload reads it back', async () => {
  const { db, model } = await saved({ poolSeasonMode: 'allYear' });
  assert.equal(model.getByIdWithDetails(1).poolSeasonMode, 'allYear');
  assert.deepEqual(poolOf(db), { s: '01-01', e: '12-31' });
});

test('rule 23: the J-7 pool sentence matches every stay with the all-year bounds, one crossing the New Year included', () => {
  const stay = (startDate, endDate, pool) => buildStayContent({
    reservation: { id: 1, startDate, endDate, adults: 2, platform: 'direct' },
    client: { id: 1, email: 'c@x.fr' },
    property: { name: 'Le Gîte', nameArticle: 'au', poolSeasonStart: pool[0], poolSeasonEnd: pool[1] },
    options: [], facts: { optionMeta: {}, defaults: [], available: [], properties: [] }, settings: {}, lang: 'fr', sequence: {},
  }).flags.stayOverlapsPool;
  for (const [from, to] of [['2026-12-30', '2027-01-02'], ['2027-01-10', '2027-01-17'], ['2027-12-26', '2027-12-31']]) {
    assert.equal(stay(from, to, ['01-01', '12-31']), true, `${from} → ${to}`);
  }
  assert.equal(stay('2027-01-10', '2027-01-17', ['06-15', '08-31']), false);
});

test('rule 46: a lone bound is completed from the stored season before the order is checked', () => {
  const stored = { poolSeasonStart: '06-15', poolSeasonEnd: '08-31' };
  assert.equal(validatePropertyInput({ poolSeasonEnd: '03-01' }, stored).poolSeasonEnd, 'La fermeture suit l\'ouverture.');
  assert.equal(validatePropertyInput({ poolSeasonStart: '09-15' }, stored).poolSeasonEnd, 'La fermeture suit l\'ouverture.');
  assert.deepEqual(validatePropertyInput({ poolSeasonEnd: '09-30' }, stored), {});
});

test('rule 46: a lone bound with nothing stored for the other is a half season, refused', () => {
  assert.equal(validatePropertyInput({ poolSeasonStart: '06-15' }, { poolSeasonStart: '', poolSeasonEnd: '' }).poolSeasonEnd, 'Les deux dates.');
  assert.equal(validatePropertyInput({ poolSeasonEnd: '08-31' }, null).poolSeasonStart, 'Les deux dates.');
});

test('rule 47: a legacy reversed season left as it is never blocks a save; touching it does', () => {
  const legacy = { poolSeasonStart: '10-01', poolSeasonEnd: '05-31' };
  assert.deepEqual(validatePropertyInput({ name: 'x', poolSeasonStart: '10-01', poolSeasonEnd: '05-31' }, legacy), {});
  assert.deepEqual(validatePropertyInput({ name: 'x', poolSeasonMode: 'season', poolSeasonStart: '10-01', poolSeasonEnd: '05-31' }, legacy), {});
  assert.deepEqual(validatePropertyInput({ name: 'x' }, legacy), {});
  assert.ok(validatePropertyInput({ poolSeasonEnd: '05-30' }, legacy).poolSeasonEnd);
  assert.ok(validatePropertyInput({ poolSeasonMode: 'season', poolSeasonStart: '10-01', poolSeasonEnd: '05-31' }, { poolSeasonStart: '', poolSeasonEnd: '' }).poolSeasonEnd);
});

test('rule 47: clearing both bounds with the legacy payload stays « no pool »', () => {
  assert.deepEqual(validatePropertyInput({ poolSeasonStart: '', poolSeasonEnd: '' }, { poolSeasonStart: '06-15', poolSeasonEnd: '08-31' }), {});
});
