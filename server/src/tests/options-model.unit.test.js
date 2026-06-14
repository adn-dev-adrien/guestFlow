const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const optionsModel = require('../models/optionsModel');

const DDL = `
  CREATE TABLE options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, priceType TEXT, price REAL,
    optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
    autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT,
    countsAsBedLinen INTEGER NOT NULL DEFAULT 0,
    countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0,
    linenIncludesSingle INTEGER NOT NULL DEFAULT 1,
    linenIncludesDouble INTEGER NOT NULL DEFAULT 1,
    linenIncludesBaby INTEGER NOT NULL DEFAULT 1,
    towelLargePerPerson INTEGER NOT NULL DEFAULT 1,
    towelMediumPerPerson INTEGER NOT NULL DEFAULT 0,
    towelSmallPerPerson INTEGER NOT NULL DEFAULT 1,
    archivedAt TEXT
  );
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return { db, model: optionsModel.buildModel(db) };
}

test('create links properties; list/get return propertyIds + normalized tiers', () => {
  const { model } = freshModel();
  const { id } = model.create({ title: 'ménage', priceType: 'per_stay', price: 50, propertyIds: [1, 2] });
  const got = model.get(id);
  assert.equal(got.title, 'Ménage'); // sentenceCase
  assert.deepEqual(got.propertyIds.sort(), [1, 2]);

  const list = model.list();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].propertyIds.sort(), [1, 2]);
  assert.equal(model.get(999), null);
});

test('update replaces the property links', () => {
  const { model } = freshModel();
  const { id } = model.create({ title: 'Opt', priceType: 'per_stay', price: 10, propertyIds: [1, 2, 3] });
  model.update(id, { title: 'Opt', priceType: 'per_stay', price: 10, propertyIds: [5] });
  assert.deepEqual(model.get(id).propertyIds, [5]);
});

test('progressive tiers are normalized (deduped, sorted, sanitized)', () => {
  const { model } = freshModel();
  const { id } = model.create({
    title: 'Prog', priceType: 'per_participant_progressive', price: 0,
    optionProgressiveTiers: [{ participantNumber: 2, unitPrice: 20 }, { participantNumber: 1, unitPrice: 30 }, { participantNumber: 2, unitPrice: 25 }],
  });
  const tiers = model.get(id).optionProgressiveTiers;
  assert.deepEqual(tiers, [{ participantNumber: 1, unitPrice: 30 }, { participantNumber: 2, unitPrice: 25 }]);
});

test('remove ARCHIVES the option (soft-delete): row kept, hidden from list, applicability kept, defaults cleared', () => {
  const { db, model } = freshModel();
  const { id } = model.create({ title: 'X', priceType: 'per_stay', price: 5, propertyIds: [1] });
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, ?, 1)').run(id);

  const res = model.remove(id);
  assert.equal(res.ok, true);
  // The row is kept (archived), so an existing reservation's JOIN still resolves it.
  const row = db.prepare('SELECT archivedAt FROM options WHERE id = ?').get(id);
  assert.ok(row && row.archivedAt, 'archivedAt set');
  // Hidden from the catalog list (offering) but applicability link kept (re-pricing existing reservations).
  assert.equal(model.list().some((o) => o.id === id), false, 'archived option absent from list()');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM property_options WHERE optionId = ?').get(id).c, 1, 'applicability kept');
  // No longer auto-added to new reservations.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM property_option_defaults WHERE optionId = ?').get(id).c, 0, 'defaults cleared');
});

test('remove rejects an auto-option (non-deletable)', () => {
  const { model } = freshModel();
  const { id } = model.create({ title: 'Petit déjeuner', priceType: 'per_person', price: 8, autoOptionType: 'breakfast' });
  const res = model.remove(id);
  assert.equal(res.error, 'AUTO_OPTION_NON_DELETABLE');
  assert.ok(model.list().some((o) => o.id === id), 'still present (not archived)');
});

test('listForProperty excludes archived options (not offered for new reservations)', () => {
  const { db, model } = freshModel();
  const { id } = model.create({ title: 'Parking', priceType: 'per_stay', price: 10, propertyIds: [1] });
  assert.equal(model.listForProperty(1).some((o) => o.id === id), true);
  model.remove(id);
  assert.equal(model.listForProperty(1).some((o) => o.id === id), false, 'archived → not applicable for new reservations');
});

// --- §3.5.ter regression tests: linen config round-trips through create + update ---

test('REGRESSION: create persists all 6 linen-config columns + countsAs flags', () => {
  // Pin the create payload contract — any code change that drops a column from the INSERT
  // statement breaks this. Important because the OptionsPage form sends all 6 + the 2 flags,
  // and we must NEVER silently lose the operator's per-type tuning.
  const { model } = freshModel();
  const { id } = model.create({
    title: 'Linge de lit',
    priceType: 'per_stay',
    price: 5,
    autoOptionType: 'bed_linen',
    countsAsBedLinen: true,
    countsAsBathroomLinen: false,
    linenIncludesSingle: false,
    linenIncludesDouble: true,
    linenIncludesBaby: false,
    towelLargePerPerson: 2,
    towelMediumPerPerson: 3,
    towelSmallPerPerson: 1,
  });
  const got = model.get(id);
  assert.equal(Number(got.countsAsBedLinen), 1);
  assert.equal(Number(got.countsAsBathroomLinen), 0);
  assert.equal(Number(got.linenIncludesSingle), 0, 'unchecked bed type persisted as 0');
  assert.equal(Number(got.linenIncludesDouble), 1);
  assert.equal(Number(got.linenIncludesBaby), 0);
  assert.equal(Number(got.towelLargePerPerson), 2);
  assert.equal(Number(got.towelMediumPerPerson), 3);
  assert.equal(Number(got.towelSmallPerPerson), 1);
});

test('REGRESSION: update rewrites all 6 linen-config columns + countsAs flags', () => {
  // Pin the update payload contract — same risk as create, with the added concern that
  // editing an option from the form must commit the new linen values, not silently drop them.
  const { model } = freshModel();
  const { id } = model.create({
    title: 'Linge de toilette',
    priceType: 'per_person',
    price: 8,
    countsAsBathroomLinen: true,
    towelLargePerPerson: 1,
    towelMediumPerPerson: 0,
    towelSmallPerPerson: 1,
  });
  model.update(id, {
    title: 'Linge de toilette',
    priceType: 'per_person',
    price: 8,
    countsAsBathroomLinen: true,
    linenIncludesSingle: false,
    linenIncludesDouble: false,
    linenIncludesBaby: false,
    towelLargePerPerson: 1,
    towelMediumPerPerson: 1,
    towelSmallPerPerson: 0,
  });
  const got = model.get(id);
  assert.equal(Number(got.linenIncludesSingle), 0);
  assert.equal(Number(got.towelMediumPerPerson), 1, 'medium per-person now > 0');
  assert.equal(Number(got.towelSmallPerPerson), 0, 'small silenced');
});

test('REGRESSION: defaults preserve legacy behaviour when create omits linen fields', () => {
  // Backstop for the migration story — a brand-new custom option created from the form (with
  // empty `countsAs…` defaults) MUST come out with `linenIncludes* = 1` and
  // `towelLarge / Medium / SmallPerPerson = 1 / 0 / 1` so existing rows behave identically.
  const { model } = freshModel();
  const { id } = model.create({ title: 'Plain option', priceType: 'per_stay', price: 0 });
  const got = model.get(id);
  assert.equal(Number(got.linenIncludesSingle), 1);
  assert.equal(Number(got.linenIncludesDouble), 1);
  assert.equal(Number(got.linenIncludesBaby), 1);
  assert.equal(Number(got.towelLargePerPerson), 1);
  assert.equal(Number(got.towelMediumPerPerson), 0);
  assert.equal(Number(got.towelSmallPerPerson), 1);
});

test('REGRESSION: towel*PerPerson coerced to a non-negative integer floor', () => {
  // Backstop for the boundary cases — the form sends numbers, but a malformed payload (string
  // / negative / decimal) must not crash the engine or leave bad data on disk.
  const { model } = freshModel();
  const { id } = model.create({
    title: 'edge',
    priceType: 'per_person',
    price: 0,
    countsAsBathroomLinen: true,
    towelLargePerPerson: '2.7',  // string-decimal → floor → 2
    towelMediumPerPerson: -5,    // negative → clamped to 0
    towelSmallPerPerson: undefined, // undefined → default 1
  });
  const got = model.get(id);
  assert.equal(Number(got.towelLargePerPerson), 2);
  assert.equal(Number(got.towelMediumPerPerson), 0);
  assert.equal(Number(got.towelSmallPerPerson), 1);
});
