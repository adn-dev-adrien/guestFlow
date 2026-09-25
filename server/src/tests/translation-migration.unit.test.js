/**
 * specs/translation-catalogue.md §5 — moving the English out of the tables, once.
 *
 * `options.titleEn` and `resources.nameEn` hold real work: 32 English titles typed by hand. This
 * migration deletes those columns, so the suite is mostly about the ORDER — copy, then verify, then
 * drop — and about the one guard that matters: if a single value could not be read back from the
 * catalogue, nothing is dropped at all.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { runTranslationCatalogueMigration, applyDefaultTranslations } = require('../utils/translationCatalogueMigration');
const translationsModel = require('../models/translationsModel');
const { optionKey, resourceKey } = require('../utils/translationCollector');
const { freshDb, addOption, addResource } = require('./translationCatalogueFixture');

const silent = { log: () => {} };
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

function legacyDb() {
  const db = freshDb();
  addOption(db, { id: 21, title: 'Jus de pomme 1L', titleEn: 'Apple juice 1L' });
  addOption(db, { id: 22, title: 'Champagne', titleEn: '' });
  addResource(db, { id: 2, name: 'Bain nordique', nameEn: 'Nordic bath' });
  return db;
}

test('the existing English is copied into the catalogue, then the columns are dropped (§5)', () => {
  const db = legacyDb();
  const result = runTranslationCatalogueMigration(db, { logger: silent });

  const english = translationsModel.create(db).valuesFor('en');
  assert.equal(english.get(optionKey(21, 'title')), 'Apple juice 1L');
  assert.equal(english.get(resourceKey(2)), 'Nordic bath');
  assert.equal(english.get(optionKey(22, 'title')), undefined, 'an empty column is not a translation');

  assert.ok(!columns(db, 'options').includes('titleEn'));
  assert.ok(!columns(db, 'resources').includes('nameEn'));
  assert.equal(result.copied, 2);
  assert.deepEqual(result.dropped, ['options.titleEn', 'resources.nameEn']);
});

test('a value that could not be read back aborts the whole migration — the columns stay (§5)', () => {
  const db = legacyDb();
  // Make the write silently do nothing, exactly as a failed copy would.
  const model = translationsModel.create(db);
  const realCreate = translationsModel.create;
  translationsModel.create = (database) => ({ ...model, seedValue: () => false, valuesFor: () => new Map() });
  try {
    assert.throws(() => runTranslationCatalogueMigration(db, { logger: silent }), /n'ont pas été reprises/);
  } finally {
    translationsModel.create = realCreate;
  }
  assert.ok(columns(db, 'options').includes('titleEn'), 'nothing is dropped when something was lost');
  assert.ok(columns(db, 'resources').includes('nameEn'));
});

test('what the operator typed wins over the English GuestFlow ships with (§5)', () => {
  const db = freshDb();
  // « Ménage » ships as « Cleaning »; this install renamed it.
  addOption(db, { id: 3, title: 'Ménage', titleEn: 'Housekeeping' });
  runTranslationCatalogueMigration(db, { logger: silent });
  assert.equal(translationsModel.create(db).valuesFor('en').get(optionKey(3, 'title')), 'Housekeeping');
});

test('the shipped English fills what is still empty (§5)', () => {
  const db = freshDb();
  addOption(db, { id: 3, title: 'Ménage' });
  addResource(db, { id: 1, name: 'Lit bébé' });
  runTranslationCatalogueMigration(db, { logger: silent });
  const english = translationsModel.create(db).valuesFor('en');
  assert.equal(english.get(optionKey(3, 'title')), 'Cleaning');
  // The option « Lit bébé » is the supplement; the RESOURCE of the same name is the cot itself.
  assert.equal(english.get(resourceKey(1)), 'Baby bed');
});

test('applying the defaults never overwrites an existing translation', () => {
  const db = freshDb();
  addOption(db, { id: 3, title: 'Ménage' });
  runTranslationCatalogueMigration(db, { logger: silent });
  const model = translationsModel.create(db);
  model.applyImport(model.planImport([{ entryKey: optionKey(3, 'title'), values: { en: 'Housekeeping' }, reviewAcknowledged: true, line: 2 }]));
  assert.equal(applyDefaultTranslations(model), 0);
  assert.equal(model.valuesFor('en').get(optionKey(3, 'title')), 'Housekeeping');
});

test('running it on a database that has already been migrated is a no-op (§5)', () => {
  const db = legacyDb();
  runTranslationCatalogueMigration(db, { logger: silent });
  const before = db.prepare('SELECT entryKey, lang, text FROM translation_values ORDER BY entryKey, lang').all();
  const second = runTranslationCatalogueMigration(db, { logger: silent });
  assert.equal(second.copied, 0);
  assert.deepEqual(second.dropped, []);
  assert.deepEqual(db.prepare('SELECT entryKey, lang, text FROM translation_values ORDER BY entryKey, lang').all(), before);
});
