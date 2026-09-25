/**
 * specs/translation-catalogue.md rules 5, 11, 12, 13 — what an uploaded file is allowed to change.
 *
 * The review flag is the subject: it is never stored, it is `sourceAtTime <> sourceText`, and the
 * only way to clear it is to empty that cell. Around it sit the three refusals an import owes the
 * operator — an unknown key creates nothing, a removal is counted before it happens, and the whole
 * file applies or none of it does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { collectSources, optionKey } = require('../utils/translationCollector');
const translationsModel = require('../models/translationsModel');
const { freshDb, addOption } = require('./translationCatalogueFixture');

const KEY = optionKey(21, 'title');

function catalogueWithTranslation() {
  const db = freshDb();
  addOption(db, { id: 21, title: 'Jus de pomme 1L' });
  const model = translationsModel.create(db);
  model.collect(collectSources(db));
  model.seedValue({ entryKey: KEY, lang: 'en', text: 'Apple juice 1L', sourceAtTime: 'Jus de pomme 1L' });
  return { db, model };
}

const stored = (db) => db.prepare('SELECT text, sourceAtTime FROM translation_values WHERE entryKey = ? AND lang = ?').get(KEY, 'en');
const isFlagged = (db) => {
  const v = stored(db);
  const e = db.prepare('SELECT sourceText FROM translation_entries WHERE entryKey = ?').get(KEY);
  return Boolean(v) && v.sourceAtTime !== e.sourceText;
};

test('the review flag is derived, never a column (rule 5)', () => {
  const { db } = catalogueWithTranslation();
  const columns = db.prepare('PRAGMA table_info(translation_values)').all().map((c) => c.name);
  assert.ok(!columns.some((c) => /review|revérifier|verifier/i.test(c)),
    'a flag that can be computed must not also be stored — the two would drift');
});

test('correcting the French raises the flag and keeps the translation (rule 5)', () => {
  const { db, model } = catalogueWithTranslation();
  assert.equal(isFlagged(db), false);
  db.prepare("UPDATE options SET title = 'Jus de pommes 1L' WHERE id = 21").run();
  model.collect(collectSources(db));
  assert.equal(stored(db).text, 'Apple juice 1L', 'nothing is lost to a typo fix');
  assert.equal(isFlagged(db), true);
  assert.equal(model.summary(['en']).needsReview, 1);
});

test('emptying the « à revérifier » cell clears it, without touching the translation (rule 5)', () => {
  const { db, model } = catalogueWithTranslation();
  db.prepare("UPDATE options SET title = 'Jus de pommes 1L' WHERE id = 21").run();
  model.collect(collectSources(db));

  const plan = model.planImport([{ entryKey: KEY, values: { en: 'Apple juice 1L' }, reviewAcknowledged: true, line: 2 }]);
  assert.equal(plan.reviewClears.length, 1);
  assert.equal(plan.updates.length, 0, 'the text did not change, so it is not an update');
  model.applyImport(plan);

  assert.equal(stored(db).text, 'Apple juice 1L');
  assert.equal(isFlagged(db), false);
});

test('sending the file back with the flag still set leaves it set (rule 5)', () => {
  const { db, model } = catalogueWithTranslation();
  db.prepare("UPDATE options SET title = 'Jus de pommes 1L' WHERE id = 21").run();
  model.collect(collectSources(db));
  model.applyImport(model.planImport([{ entryKey: KEY, values: { en: 'Apple juice 1L' }, reviewAcknowledged: false, line: 2 }]));
  assert.equal(isFlagged(db), true);
});

test('retranslating clears the flag too, because the new text answers the new French (rule 5)', () => {
  const { db, model } = catalogueWithTranslation();
  db.prepare("UPDATE options SET title = 'Jus de poire 1L' WHERE id = 21").run();
  model.collect(collectSources(db));
  model.applyImport(model.planImport([{ entryKey: KEY, values: { en: 'Pear juice 1L' }, reviewAcknowledged: false, line: 2 }]));
  assert.equal(stored(db).text, 'Pear juice 1L');
  assert.equal(isFlagged(db), false);
});

test('an unknown key is ignored and counted, never created (rule 13)', () => {
  const { db, model } = catalogueWithTranslation();
  const plan = model.planImport([
    { entryKey: 'option:999:title', values: { en: 'Ghost' }, reviewAcknowledged: true, line: 2 },
    { entryKey: KEY, values: { en: 'Apple juice 1L' }, reviewAcknowledged: true, line: 3 },
  ]);
  assert.equal(plan.ignoredUnknown, 1);
  model.applyImport(plan);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM translation_entries').get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM translation_values WHERE entryKey = 'option:999:title'").get().n, 0);
});

test('an emptied language cell is planned as a removal, and counted before anything is written (rule 12)', () => {
  const { db, model } = catalogueWithTranslation();
  const plan = model.planImport([{ entryKey: KEY, values: { en: '' }, reviewAcknowledged: true, line: 2 }]);
  assert.equal(plan.removals.length, 1);
  assert.equal(plan.removals[0].was, 'Apple juice 1L');
  // Planning must not have touched the database: that is what lets the caller ask first.
  assert.equal(stored(db).text, 'Apple juice 1L');
  model.applyImport(plan);
  assert.equal(stored(db), undefined);
});

test('an emptied cell on an already-empty language is not a removal', () => {
  const { model } = catalogueWithTranslation();
  const plan = model.planImport([{ entryKey: KEY, values: { de: '' }, reviewAcknowledged: true, line: 2 }]);
  assert.equal(plan.removals.length, 0);
  assert.equal(plan.updates.length, 0);
});

test('a language nobody declared appears simply by filling its column (rule 17)', () => {
  const { db, model } = catalogueWithTranslation();
  assert.deepEqual(model.languagesInUse(), ['en']);
  model.applyImport(model.planImport([{ entryKey: KEY, values: { de: 'Apfelsaft 1L' }, reviewAcknowledged: true, line: 2 }]));
  assert.deepEqual(model.languagesInUse(), ['de', 'en'].sort());
  assert.equal(model.valuesFor('de').get(KEY), 'Apfelsaft 1L');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('translation_values') WHERE name = 'deutsch'").get().n, 0,
    'a new language must cost no schema change');
});
