/**
 * Shared fixture for the translation-catalogue suites (specs/translation-catalogue.md).
 *
 * A sibling module rather than an export from one of the suites: a test file must never have to
 * import — and therefore re-run — another one (CLAUDE.md §9).
 */

const Database = require('better-sqlite3');

const SCHEMA = `
  CREATE TABLE options (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
    category TEXT NOT NULL DEFAULT '', archivedAt TEXT, titleEn TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE resources (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, nameEn TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE translation_entries (
    entryKey TEXT PRIMARY KEY, kind TEXT NOT NULL, sourceId INTEGER,
    sourceText TEXT NOT NULL, seenAt TEXT NOT NULL
  );
  CREATE TABLE translation_values (
    entryKey TEXT NOT NULL, lang TEXT NOT NULL, text TEXT NOT NULL, sourceAtTime TEXT NOT NULL,
    PRIMARY KEY (entryKey, lang)
  );
`;

/** A database holding the two source tables, the catalogue, and the legacy columns. */
function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return db;
}

function addOption(db, { id, title, description = '', category = '', titleEn = '', archivedAt = null }) {
  db.prepare('INSERT INTO options (id, title, description, category, archivedAt, titleEn) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, title, description, category, archivedAt, titleEn);
}

function addResource(db, { id, name, nameEn = '' }) {
  db.prepare('INSERT INTO resources (id, name, nameEn) VALUES (?, ?, ?)').run(id, name, nameEn);
}

/** The two options and the resource used across the suites, with one description and one category. */
function seedSources(db) {
  addOption(db, { id: 12, title: 'Animation-animaux sauvage', description: 'Partez à la recherche des indices', category: 'Animations' });
  addOption(db, { id: 21, title: 'Jus de pomme 1L', description: '3 pommes — Pressoir du Pilat', category: 'Boissons' });
  addResource(db, { id: 2, name: 'Bain nordique' });
  return db;
}

module.exports = { freshDb, addOption, addResource, seedSources, SCHEMA };
