const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  createTariffChangeJournalModel, normalizeOccurredAt,
} = require('../models/tariffChangeJournalModel');

// specs/tariff-change-journal.md — the register of WHEN the grid changed. Nothing here prices
// anything; what these tests protect is that a date, once recorded, is exact and durable.

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT,
      tariffRecipeId TEXT DEFAULT '', tariffRecipeVersion TEXT DEFAULT '',
      updatedAt TEXT
    );
    CREATE TABLE tariff_change_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      propertyId    INTEGER NOT NULL,
      kind          TEXT    NOT NULL,
      recipeId      TEXT    NOT NULL DEFAULT '',
      recipeVersion TEXT    NOT NULL DEFAULT '',
      occurredAt    TEXT    NOT NULL,
      source        TEXT    NOT NULL DEFAULT 'manual',
      note          TEXT    NOT NULL DEFAULT '',
      createdAt     TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
    );
  `);
  db.prepare("INSERT INTO properties (id, name, tariffRecipeId, tariffRecipeVersion, updatedAt) VALUES (1, 'Aventura lodge', 'aventura-lodge-2026', '1.1.0', '2026-08-12 16:08:41')").run();
  db.prepare("INSERT INTO properties (id, name, tariffRecipeId, tariffRecipeVersion, updatedAt) VALUES (2, 'Gite', '', '', '2026-06-10 15:11:24')").run();
  return db;
}

// ── Rule 3 — a date that cannot be trusted is refused, never stored approximately ──────────────

test('normalizeOccurredAt accepts the shapes a form can send and refuses the rest', () => {
  assert.equal(normalizeOccurredAt('2026-08-14'), '2026-08-14 00:00:00');
  assert.equal(normalizeOccurredAt('2026-08-14 09:30'), '2026-08-14 09:30:00');
  assert.equal(normalizeOccurredAt('2026-08-14T09:30:15'), '2026-08-14 09:30:15');

  for (const bad of ['', null, undefined, '14/08/2026', '2026-13-01', '2026-02-30', '2026-04-31', '2026-08-14 25:00', 'hier']) {
    assert.equal(normalizeOccurredAt(bad), null, `attendu refusé : ${String(bad)}`);
  }
});

test("une date d'effet invalide est refusée avec un message, pas enregistrée", () => {
  const journal = createTariffChangeJournalModel(makeDb());
  const out = journal.insert({ propertyId: 1, kind: 'platforms', occurredAt: '2026-02-30' });
  assert.equal(out.error, "Date d'effet invalide");
  assert.equal(journal.list().length, 0);
});

// ── Rule 2 — two natures, and only those ──────────────────────────────────────────────────────

test('les deux natures sont acceptées, toute autre est refusée', () => {
  const journal = createTariffChangeJournalModel(makeDb());
  assert.ok(journal.insert({ propertyId: 1, kind: 'recipe', occurredAt: '2026-08-12 16:08' }).event);
  assert.ok(journal.insert({ propertyId: 1, kind: 'platforms', occurredAt: '2026-08-14 11:00' }).event);
  assert.equal(journal.insert({ propertyId: 1, kind: 'promo', occurredAt: '2026-08-14' }).error, 'Nature de changement inconnue');
  assert.equal(journal.insert({ propertyId: 99, kind: 'recipe', occurredAt: '2026-08-14' }).error, 'Logement introuvable');
});

// ── Rule 4 — the date of effect and the date of entry are two different things ─────────────────

test("occurredAt et createdAt sont indépendants : on date après coup", () => {
  const journal = createTariffChangeJournalModel(makeDb());
  const { event } = journal.insert({ propertyId: 1, kind: 'platforms', occurredAt: '2026-08-14 11:00' });
  assert.equal(event.occurredAt, '2026-08-14 11:00:00');
  assert.notEqual(event.createdAt, event.occurredAt);
  assert.match(event.createdAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

// ── Rule 7 — recipe and version come from the property, not from the caller ────────────────────

test('la recette et sa version sont déduites du logement, pas du formulaire', () => {
  const journal = createTariffChangeJournalModel(makeDb());
  const { event } = journal.insert({
    propertyId: 1, kind: 'platforms', occurredAt: '2026-08-14 11:00',
    recipeId: undefined, recipeVersion: undefined,
  });
  assert.equal(event.recipeId, 'aventura-lodge-2026');
  assert.equal(event.recipeVersion, '1.1.0');
  assert.equal(event.source, 'manual');
});

// ── Rule 10 — read newest first, filterable by property ───────────────────────────────────────

test('le journal est trié par date d’effet décroissante et filtrable par logement', () => {
  const db = makeDb();
  const journal = createTariffChangeJournalModel(db);
  journal.insert({ propertyId: 1, kind: 'recipe', occurredAt: '2026-08-12 16:08' });
  journal.insert({ propertyId: 1, kind: 'platforms', occurredAt: '2026-08-14 11:00' });
  db.prepare("UPDATE properties SET tariffRecipeId = 'gite-2026' WHERE id = 2").run();
  journal.insert({ propertyId: 2, kind: 'recipe', occurredAt: '2026-07-01 09:00' });

  const all = journal.list();
  assert.deepEqual(all.map((e) => e.occurredAt), [
    '2026-08-14 11:00:00', '2026-08-12 16:08:00', '2026-07-01 09:00:00',
  ]);
  assert.deepEqual(all.map((e) => e.propertyName), ['Aventura lodge', 'Aventura lodge', 'Gite']);
  assert.deepEqual(all.map((e) => e.kindLabel), [
    'Mise en ligne sur les plateformes', 'Recette appliquée', 'Recette appliquée',
  ]);
  assert.equal(journal.list({ propertyId: 2 }).length, 1);
});

// ── Rule 9 — deleting is the only correction path ─────────────────────────────────────────────

test('un événement se supprime une fois, et une seule', () => {
  const journal = createTariffChangeJournalModel(makeDb());
  const { event } = journal.insert({ propertyId: 1, kind: 'platforms', occurredAt: '2026-08-14' });
  assert.equal(journal.remove(event.id), true);
  assert.equal(journal.remove(event.id), false);
  assert.equal(journal.list().length, 0);
});

// ── Rule 11 — the backfill dates from updatedAt, once, and invents nothing ────────────────────

// Replays the migration block of database.js against the in-memory schema, so the test protects the
// real SQL and not a paraphrase of it.
function runBackfill(db) {
  const orphans = db.prepare(`
    SELECT p.id, p.tariffRecipeId, p.tariffRecipeVersion, p.updatedAt
    FROM properties p
    WHERE p.tariffRecipeId != ''
      AND NOT EXISTS (SELECT 1 FROM tariff_change_events e WHERE e.propertyId = p.id)
  `).all();
  const stamp = db.prepare(`
    INSERT INTO tariff_change_events (propertyId, kind, recipeId, recipeVersion, occurredAt, source, note)
    VALUES (?, 'recipe', ?, ?, ?, 'backfill', ?)
  `);
  for (const row of orphans) stamp.run(row.id, row.tariffRecipeId, row.tariffRecipeVersion, row.updatedAt, 'Date déduite…');
  return orphans.length;
}

test('le rattrapage récupère la date depuis updatedAt et la marque comme déduite', () => {
  const db = makeDb();
  const journal = createTariffChangeJournalModel(db);
  assert.equal(runBackfill(db), 1); // le Gîte n'a pas de recette : rien n'est inventé

  const [event] = journal.list();
  assert.equal(event.propertyId, 1);
  assert.equal(event.kind, 'recipe');
  assert.equal(event.occurredAt, '2026-08-12 16:08:41');
  assert.equal(event.recipeVersion, '1.1.0');
  assert.equal(event.source, 'backfill');
  assert.equal(event.inferred, true, 'une date déduite doit se présenter comme telle');
});

test('le rattrapage ne s’exécute pas deux fois', () => {
  const db = makeDb();
  const journal = createTariffChangeJournalModel(db);
  runBackfill(db);
  assert.equal(runBackfill(db), 0);
  assert.equal(journal.list().length, 1);
});

test('un événement écrit par l’apply ne se présente pas comme déduit', () => {
  const db = makeDb();
  const journal = createTariffChangeJournalModel(db);
  journal.recordRecipeApply({ propertyId: 1, recipeId: 'aventura-lodge-2026', recipeVersion: '1.2.0' });
  const [event] = journal.list();
  assert.equal(event.source, 'apply');
  assert.equal(event.inferred, false);
  assert.equal(event.recipeVersion, '1.2.0');
});

// ── Rules 5 & 6 — through the REAL apply: a change is dated, a no-op is not ────────────────────

const { createTariffRecipeModel } = require('../models/tariffRecipeModel');
const { validateRecipe } = require('../utils/tariffRecipe');

// Passée par le validateur comme le ferait le vrai chargement : le test protège le chemin réel,
// pas une structure inventée à la main qui ne franchirait jamais le store.
const RECIPE = (() => {
  const out = validateRecipe({
    id: 'test-recipe', version: '2.0.0', label: 'Recette de test', horizonYears: 1,
    seasons: [{ key: 'low', label: 'Basse saison', rank: 1, color: '#1976d2', pricePerNight: 100, netTargetPerNight: 90 }],
    calendar: { baseSeason: 'low', periods: [] },
    closures: [],
  });
  assert.equal(out.valid, true, out.error);
  return out.recipe;
})();

function makeApplyDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 30,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0,
      extraGuestPriceUnit TEXT DEFAULT 'per_stay',
      tariffRecipeId TEXT DEFAULT '', tariffRecipeVersion TEXT DEFAULT '', welcomePackCost REAL DEFAULT 0, updatedAt TEXT);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, label TEXT,
      pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]',
      dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1,
      seasonKey TEXT, seasonRank INTEGER, netTargetPerNight REAL, extraGuestPrice REAL, extraGuestNetTarget REAL, maxNights INTEGER,
      changeoverArrival INTEGER, changeoverDeparture INTEGER, extraGuestTiers TEXT);
    CREATE TABLE establishment_closures (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER,
      label TEXT NOT NULL DEFAULT '', startDate TEXT NOT NULL, endDate TEXT NOT NULL, createdAt TEXT, updatedAt TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, propertyId INTEGER, startDate TEXT, endDate TEXT, kind TEXT NOT NULL DEFAULT 'reservation');
    CREATE TABLE tariff_change_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER NOT NULL, kind TEXT NOT NULL,
      recipeId TEXT NOT NULL DEFAULT '', recipeVersion TEXT NOT NULL DEFAULT '', occurredAt TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual', note TEXT NOT NULL DEFAULT '',
      createdAt TEXT DEFAULT (datetime('now')));
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura lodge')").run();
  return db;
}

test("une application de recette qui change quelque chose est datée dans le journal", () => {
  const db = makeApplyDb();
  const model = createTariffRecipeModel(db, { getRecipe: (id) => (id === RECIPE.id ? RECIPE : null) });
  const journal = createTariffChangeJournalModel(db);

  const result = model.apply(1, 'test-recipe');
  assert.equal(result.applied, true);

  const events = journal.list();
  assert.equal(events.length, 1, 'une application effective écrit exactement un événement');
  assert.equal(events[0].kind, 'recipe');
  assert.equal(events[0].source, 'apply');
  assert.equal(events[0].recipeId, 'test-recipe');
  assert.equal(events[0].recipeVersion, '2.0.0');
  assert.equal(events[0].propertyName, 'Aventura lodge');
});

test("une application sans effet n'écrit rien : un journal de non-événements serait illisible", () => {
  const db = makeApplyDb();
  const model = createTariffRecipeModel(db, { getRecipe: (id) => (id === RECIPE.id ? RECIPE : null) });
  const journal = createTariffChangeJournalModel(db);

  model.apply(1, 'test-recipe');
  const second = model.apply(1, 'test-recipe'); // rien n'a bougé depuis la première

  assert.equal(second.applied, false);
  assert.equal(journal.list().length, 1, 'la seconde application ne doit rien ajouter');
});

test('une écriture de journal impossible ne remonte jamais en exception', () => {
  // Le contrat de recordRecipeApply : perdre une ligne d'historique ne doit pas pouvoir faire
  // échouer une application de recette déjà écrite en base.
  const db = makeDb();
  db.exec('DROP TABLE tariff_change_events');
  const journal = createTariffChangeJournalModel(db);
  assert.doesNotThrow(() => journal.recordRecipeApply({ propertyId: 1, recipeId: 'x', recipeVersion: '1' }));
});
