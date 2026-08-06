// specs/option-categories.md §5.3 — the one-shot backfill of the pre-existing catalogue options.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runOptionCategoriesMigration } = require('../utils/optionCategoriesMigration');

function freshDb(titles = []) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      category TEXT NOT NULL DEFAULT ''
    );
  `);
  const insert = db.prepare('INSERT INTO options (title, category) VALUES (?, ?)');
  for (const t of titles) {
    if (typeof t === 'string') insert.run(t, '');
    else insert.run(t.title, t.category || '');
  }
  return db;
}

const categoryOf = (db, title) => db.prepare('SELECT category FROM options WHERE title = ?').get(title).category;

// The real catalogue as it stands in production (ids 11-16).
const PROD_TITLES = [
  'Animation-visite animaux',
  'Animation-animaux sauvage',
  'Animation-chasse aux œufs',
  'Animation-balade nocturne',
  'Animation enfants + bain nordique',
  'Le repas des trappeurs',
];

test('the 5 animations are filed under Animations', () => {
  const db = freshDb(PROD_TITLES);
  const { animations } = runOptionCategoriesMigration(db);
  assert.equal(animations, 5);
  for (const title of PROD_TITLES.slice(0, 5)) {
    assert.equal(categoryOf(db, title), 'Animations');
  }
});

test('« Le repas des trappeurs » goes to Restauration, not Animations', () => {
  const db = freshDb(PROD_TITLES);
  const { meals } = runOptionCategoriesMigration(db);
  assert.equal(meals, 1);
  assert.equal(categoryOf(db, 'Le repas des trappeurs'), 'Restauration');
});

test('structural options are left ungrouped', () => {
  const db = freshDb(['Ménage', 'Linge de lit', 'Petit déjeuner', 'Arrivée anticipée']);
  const { animations, meals } = runOptionCategoriesMigration(db);
  assert.equal(animations, 0);
  assert.equal(meals, 0);
  assert.equal(categoryOf(db, 'Ménage'), '');
  assert.equal(categoryOf(db, 'Linge de lit'), '');
});

test('an option that already carries a category is never re-categorised', () => {
  // The operator may have moved an animation elsewhere before the migration ran; respect that.
  const db = freshDb([
    { title: 'Animation-balade nocturne', category: 'Restauration' },
    { title: 'Le repas des trappeurs', category: 'Animations' },
  ]);
  const { animations, meals } = runOptionCategoriesMigration(db);
  assert.equal(animations, 0);
  assert.equal(meals, 0);
  assert.equal(categoryOf(db, 'Animation-balade nocturne'), 'Restauration');
  assert.equal(categoryOf(db, 'Le repas des trappeurs'), 'Animations');
});

test('matching is case-insensitive and whitespace-tolerant', () => {
  const db = freshDb(['  ANIMATION-visite ANIMAUX  ', '  LE REPAS DES TRAPPEURS ']);
  const { animations, meals } = runOptionCategoriesMigration(db);
  assert.equal(animations, 1);
  assert.equal(meals, 1);
});

test('a second run touches 0 rows', () => {
  const db = freshDb(PROD_TITLES);
  runOptionCategoriesMigration(db);
  const second = runOptionCategoriesMigration(db);
  assert.equal(second.animations, 0);
  assert.equal(second.meals, 0);
});

test('unmigrated schema: no-op rather than a crash', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);');
  const result = runOptionCategoriesMigration(db);
  assert.equal(result.skipped, 'schema');
});
