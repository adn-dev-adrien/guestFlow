const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const optionsModel = require('../models/optionsModel');

// specs/sas-breakfast-bread-and-push.md rule 7 (notify lead) + the autoOptionType preservation
// regression found during its verification: the Options edit form never sends `autoOptionType`,
// and update() used to blindly write `payload.autoOptionType || null` — one save of the breakfast
// option stripped its type, killing the planning card / SAS step / push.

const DDL = `
  CREATE TABLE options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, priceType TEXT, price REAL,
    optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
    autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT,
    countsAsBedLinen INTEGER NOT NULL DEFAULT 0, countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0,
    linenIncludesSingle INTEGER NOT NULL DEFAULT 1, linenIncludesDouble INTEGER NOT NULL DEFAULT 1,
    linenIncludesBaby INTEGER NOT NULL DEFAULT 1,
    towelLargePerPerson INTEGER NOT NULL DEFAULT 1, towelMediumPerPerson INTEGER NOT NULL DEFAULT 0,
    towelSmallPerPerson INTEGER NOT NULL DEFAULT 1,
    breakfastTime TEXT DEFAULT '09:00',
    breakfastNotifyLeadMinutes INTEGER NOT NULL DEFAULT 30
  );
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return { db, model: optionsModel.buildModel(db) };
}

test('update WITHOUT autoOptionType preserves the stored system type (breakfast survives a form save)', () => {
  const { db, model } = freshModel();
  const { id } = model.create({ title: 'Petit déjeuner', priceType: 'per_person', price: 9, autoOptionType: 'breakfast' });
  assert.equal(db.prepare('SELECT autoOptionType FROM options WHERE id = ?').get(id).autoOptionType, 'breakfast');

  // The Options edit form payload carries no autoOptionType key.
  model.update(id, { title: 'Petit déjeuner', priceType: 'per_person', price: 10 });
  assert.equal(db.prepare('SELECT autoOptionType FROM options WHERE id = ?').get(id).autoOptionType, 'breakfast');
});

test('update WITH an explicit empty autoOptionType still clears it (deliberate change stays possible)', () => {
  const { db, model } = freshModel();
  const { id } = model.create({ title: 'Ménage', autoOptionType: 'cleaning' });
  model.update(id, { title: 'Ménage', autoOptionType: null });
  assert.equal(db.prepare('SELECT autoOptionType FROM options WHERE id = ?').get(id).autoOptionType, null);
});

test('breakfastNotifyLeadMinutes persists on create/update, clamped to [0, 240], invalid → 30', () => {
  const { db, model } = freshModel();
  const lead = (id) => db.prepare('SELECT breakfastNotifyLeadMinutes AS l FROM options WHERE id = ?').get(id).l;

  const { id } = model.create({ title: 'Petit déjeuner', autoOptionType: 'breakfast', breakfastNotifyLeadMinutes: 45 });
  assert.equal(lead(id), 45);

  model.update(id, { title: 'Petit déjeuner', breakfastNotifyLeadMinutes: 999 });
  assert.equal(lead(id), 240);
  model.update(id, { title: 'Petit déjeuner', breakfastNotifyLeadMinutes: -5 });
  assert.equal(lead(id), 0);
  model.update(id, { title: 'Petit déjeuner', breakfastNotifyLeadMinutes: 'abc' });
  assert.equal(lead(id), 30);
  // Absent key → untouched.
  model.update(id, { title: 'Petit déjeuner' });
  assert.equal(lead(id), 30);
});
