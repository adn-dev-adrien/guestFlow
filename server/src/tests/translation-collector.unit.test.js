/**
 * specs/translation-catalogue.md rules 1, 4, 6 — GuestFlow collects its own entries.
 *
 * The two behaviours worth guarding are the ones that decide whether a translation survives: renaming
 * an option in French must keep it (the key is the provenance), and archiving an option must keep it
 * too (archiving is reversible, retyping a translation is not). Only a deleted row loses one.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { collectSources, optionKey, resourceKey, categoryKey } = require('../utils/translationCollector');
const translationsModel = require('../models/translationsModel');
const { freshDb, addOption, addResource, seedSources } = require('./translationCatalogueFixture');

const modelOf = (db) => translationsModel.create(db);
const keys = (db) => db.prepare('SELECT entryKey FROM translation_entries ORDER BY entryKey').all().map((r) => r.entryKey);

test('creating an option puts its title, its description and its category in the catalogue (rule 1)', () => {
  const db = seedSources(freshDb());
  modelOf(db).collect(collectSources(db));
  assert.deepEqual(keys(db), [
    categoryKey('Animations'), categoryKey('Boissons'),
    optionKey(12, 'description'), optionKey(12, 'title'),
    optionKey(21, 'description'), optionKey(21, 'title'),
    resourceKey(2),
  ]);
});

test('a category is collected once, not once per option (rule 1)', () => {
  const db = freshDb();
  addOption(db, { id: 1, title: 'Champagne', category: 'Boissons' });
  addOption(db, { id: 2, title: 'Biscanna', category: 'Boissons' });
  modelOf(db).collect(collectSources(db));
  assert.deepEqual(keys(db).filter((k) => k.startsWith('category:')), [categoryKey('Boissons')]);
});

test('an option with no description yields no description entry — nothing to translate', () => {
  const db = freshDb();
  addOption(db, { id: 1, title: 'Champagne', description: '   ' });
  modelOf(db).collect(collectSources(db));
  assert.deepEqual(keys(db), [optionKey(1, 'title')]);
});

test('renaming an option in French keeps its entry AND its translation (rule 4)', () => {
  const db = freshDb();
  addOption(db, { id: 21, title: 'Jus de pomme 1L' });
  const model = modelOf(db);
  model.collect(collectSources(db));
  model.seedValue({ entryKey: optionKey(21, 'title'), lang: 'en', text: 'Apple juice 1L', sourceAtTime: 'Jus de pomme 1L' });

  db.prepare("UPDATE options SET title = 'Jus de pommes 1L' WHERE id = 21").run();
  model.collect(collectSources(db));

  assert.equal(model.valuesFor('en').get(optionKey(21, 'title')), 'Apple juice 1L');
  assert.equal(db.prepare('SELECT sourceText FROM translation_entries WHERE entryKey = ?').get(optionKey(21, 'title')).sourceText, 'Jus de pommes 1L');
});

test('an ARCHIVED option keeps its entry; a DELETED one loses it (rule 6)', () => {
  const db = freshDb();
  addOption(db, { id: 1, title: 'Champagne' });
  addOption(db, { id: 2, title: 'Biscanna' });
  const model = modelOf(db);
  model.collect(collectSources(db));
  model.seedValue({ entryKey: optionKey(1, 'title'), lang: 'en', text: 'Champagne', sourceAtTime: 'Champagne' });

  db.prepare("UPDATE options SET archivedAt = '2026-09-25' WHERE id = 1").run();
  model.collect(collectSources(db));
  assert.ok(keys(db).includes(optionKey(1, 'title')), 'archiving must not cost a translation');
  assert.equal(model.valuesFor('en').get(optionKey(1, 'title')), 'Champagne');

  db.prepare('DELETE FROM options WHERE id = 1').run();
  model.collect(collectSources(db));
  assert.ok(!keys(db).includes(optionKey(1, 'title')), 'a deleted source keeps no entry');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM translation_values WHERE entryKey = ?').get(optionKey(1, 'title')).n, 0,
    'and leaves no orphaned translation behind');
});

test('collecting twice changes nothing (rule 1 — idempotent)', () => {
  const db = seedSources(freshDb());
  const model = modelOf(db);
  model.collect(collectSources(db));
  const before = db.prepare('SELECT entryKey, sourceText FROM translation_entries ORDER BY entryKey').all();
  const second = model.collect(collectSources(db));
  assert.deepEqual(second, { added: 0, updated: 0, removed: 0 });
  assert.deepEqual(db.prepare('SELECT entryKey, sourceText FROM translation_entries ORDER BY entryKey').all(), before);
});

test('a renamed CATEGORY is a new entry, because its text is its identity (rule 4)', () => {
  const db = freshDb();
  addOption(db, { id: 1, title: 'Champagne', category: 'Boissons' });
  const model = modelOf(db);
  model.collect(collectSources(db));
  db.prepare("UPDATE options SET category = 'Boissons & vins' WHERE id = 1").run();
  model.collect(collectSources(db));
  const cats = keys(db).filter((k) => k.startsWith('category:'));
  assert.deepEqual(cats, [categoryKey('Boissons & vins')]);
});

test('a resource is collected by its id, so renaming it keeps its translation (rules 1, 4)', () => {
  const db = freshDb();
  addResource(db, { id: 2, name: 'Bain nordique' });
  const model = modelOf(db);
  model.collect(collectSources(db));
  model.seedValue({ entryKey: resourceKey(2), lang: 'en', text: 'Nordic bath', sourceAtTime: 'Bain nordique' });
  db.prepare("UPDATE resources SET name = 'Bain nordique privatif' WHERE id = 2").run();
  model.collect(collectSources(db));
  assert.equal(model.valuesFor('en').get(resourceKey(2)), 'Nordic bath');
});
