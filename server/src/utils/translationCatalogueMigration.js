/**
 * Moves the English out of the tables and into the catalogue, once
 * (specs/translation-catalogue.md §5).
 *
 * `options.titleEn` and `resources.nameEn` hold real work — 32 English titles typed by hand — and
 * this migration deletes those columns. The order is therefore not negotiable:
 *
 *   1. collect, so every entry the values will hang off exists;
 *   2. copy the columns into the catalogue — operator data first, before any default can occupy the
 *      slot;
 *   3. fill what is still empty with the English GuestFlow ships with;
 *   4. **verify**: every non-empty legacy value must be readable from the catalogue;
 *   5. only then, drop the columns.
 *
 * Step 4 is the point of the whole module. The caller runs all of this inside one transaction, so a
 * throw anywhere rolls back the drop and leaves the columns exactly where they were — the migration
 * is simply retried on the next boot, with the reason in the log.
 */

const { collectSources, optionKey, resourceKey } = require('./translationCollector');
const { DEFAULT_TRANSLATIONS } = require('./defaultTranslations');

function columnsOf(database, table) {
  try { return database.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name); }
  catch { return []; }
}

/**
 * Fill the English GuestFlow ships with, wherever nothing is there yet.
 *
 * Runs in the migration AND on every boot: `ensureDefaultTimedOptionsForProperty` creates the check-in
 * and check-out options the day a property is added, long after the migration has run, and those need
 * their English too. Never overwrites — an operator's translation always wins.
 */
function applyDefaultTranslations(model) {
  const entries = model.listEntries();
  let filled = 0;
  for (const def of DEFAULT_TRANSLATIONS) {
    for (const entry of entries) {
      if (entry.kind !== def.kind || entry.sourceText !== def.fr) continue;
      if (entry.values && entry.values.en && String(entry.values.en.text).trim()) continue;
      if (model.seedValue({ entryKey: entry.entryKey, lang: 'en', text: def.en, sourceAtTime: entry.sourceText })) filled += 1;
    }
  }
  return filled;
}

function runTranslationCatalogueMigration(database, { logger = console } = {}) {
  const model = require('../models/translationsModel').create(database);

  model.collect(collectSources(database));

  const legacy = [];
  if (columnsOf(database, 'options').includes('titleEn')) {
    for (const row of database.prepare("SELECT id, title, titleEn FROM options WHERE TRIM(COALESCE(titleEn, '')) <> ''").all()) {
      legacy.push({ entryKey: optionKey(row.id, 'title'), text: row.titleEn, sourceAtTime: row.title });
    }
  }
  if (columnsOf(database, 'resources').includes('nameEn')) {
    for (const row of database.prepare("SELECT id, name, nameEn FROM resources WHERE TRIM(COALESCE(nameEn, '')) <> ''").all()) {
      legacy.push({ entryKey: resourceKey(row.id), text: row.nameEn, sourceAtTime: row.name });
    }
  }
  for (const value of legacy) model.seedValue({ ...value, lang: 'en' });

  // Only now the shipped defaults, and only where nothing was copied: what the operator typed wins.
  const defaults = applyDefaultTranslations(model);

  // Step 4 — nothing may be lost. Read the catalogue back and demand every legacy value is in it.
  const stored = model.valuesFor('en');
  const missing = legacy.filter((v) => !stored.has(v.entryKey));
  if (missing.length) {
    throw new Error(
      `[translation-catalogue] ${missing.length} traduction(s) n'ont pas été reprises `
      + `(${missing.slice(0, 3).map((m) => m.entryKey).join(', ')}…) — les colonnes ne sont PAS supprimées.`
    );
  }

  const dropped = [];
  if (columnsOf(database, 'options').includes('titleEn')) {
    database.exec('ALTER TABLE options DROP COLUMN titleEn');
    dropped.push('options.titleEn');
  }
  if (columnsOf(database, 'resources').includes('nameEn')) {
    database.exec('ALTER TABLE resources DROP COLUMN nameEn');
    dropped.push('resources.nameEn');
  }

  const action = `${legacy.length} traduction(s) reprises, ${defaults} par défaut, colonnes supprimées : ${dropped.join(', ') || 'aucune'}`;
  if (logger && logger.log) logger.log(`[migration:translation-catalogue] ${action}`);
  return { copied: legacy.length, defaults, dropped };
}

module.exports = { runTranslationCatalogueMigration, applyDefaultTranslations };
