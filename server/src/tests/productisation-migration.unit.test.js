// specs/plugins-phase-p-productisation.md §3.E rules 24–25 — productisation_v1 runs only on a database
// with data, never twice, never overwrites, and writes each item listed.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, seedProperty, seedReservation, seedClient } = require('./guestEmailSequenceFixtures');
const { applyProductisationSchema, runProductisationMigration, SOLIO_TEXTS } = require('../utils/productisationMigration');
const { ensurePluginsTable, ensurePluginSettingsTable } = require('../utils/pluginsSchema');

function base() {
  const db = freshDb();
  applyProductisationSchema(db);
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT DEFAULT (datetime(\'now\')))');
  return db;
}

function solio() {
  const db = base();
  seedProperty(db, { id: 1, name: 'La Granja', hasFilterCoffeeMaker: 1 });
  seedProperty(db, { id: 2, name: 'L\'Estiva' });
  seedClient(db);
  seedReservation(db, { platform: 'lodgify' });
  const add = db.prepare('INSERT INTO options (id, title, price, seedKey, category, autoOptionType) VALUES (?, ?, ?, ?, ?, ?)');
  add.run(1, 'Jus de pomme 1L', 5, 'drink_jus_pomme_1l', 'Boissons', null);
  add.run(2, 'Jus de poire 1L', 6, 'drink_jus_poire_1l', 'Boissons', null);
  add.run(3, 'Blonde du Pilat 75cl', 6.5, 'drink_blonde_pilat_75', 'Boissons', null);
  add.run(4, 'Planche S', 17, 'board_s', 'Restauration', null);
  add.run(5, 'Le repas des trappeurs', 25, '', 'Restauration', null);
  add.run(6, 'Petit déjeuner', 12, '', 'Restauration', 'breakfast');
  add.run(7, 'Animation-visite animaux', 30, '', 'Animations', null);
  add.run(8, 'Linge de lit', 12, '', '', 'bed_linen');
  db.prepare("INSERT INTO resources (id, name) VALUES (1, 'Bain nordique'), (2, 'Vélo')").run();
  db.prepare("INSERT INTO plugins (id, enabled) VALUES ('sas', 1)").run();
  return db;
}

const texts = (db, propertyId = 0) => Object.fromEntries(db.prepare('SELECT key, fr FROM stay_texts WHERE propertyId = ?').all(propertyId).map((r) => [r.key, r.fr]));

test('rule 24: a new database records the migration and gets nothing', () => {
  const db = base();
  assert.deepEqual(runProductisationMigration(db, { env: {} }), { action: 'fresh' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stay_texts').get().n, 0);
  seedProperty(db);
  assert.deepEqual(runProductisationMigration(db, { env: {} }), { action: 'skipped' }, 'never later either');
  assert.equal(db.prepare('SELECT onboardingCompletedAt FROM app_settings').get().onboardingCompletedAt, null);
});

test('rule 24: an existing database keeps today\'s wording, globally and per property', () => {
  const db = solio();
  const result = runProductisationMigration(db, { env: {} });
  assert.equal(result.action, 'migrated');
  const global = texts(db);
  assert.equal(global['bag.items'], SOLIO_TEXTS['bag.items'].fr);
  assert.match(global.house, /Nespresso/);
  assert.equal(global['complement.atArrival'], undefined, 'identical to the default: nothing written');
  assert.match(texts(db, 1).house, /cafetière familiale/);
  assert.equal(texts(db, 2).house, undefined);
  assert.ok(db.prepare('SELECT onboardingCompletedAt FROM app_settings').get().onboardingCompletedAt);
});

test('rule 24: one mention per role found, with today\'s sentences, price and orders', () => {
  const db = solio();
  runProductisationMigration(db, { env: {} });
  const mentions = db.prepare('SELECT * FROM email_mentions ORDER BY sortOrder').all();
  const links = (id) => db.prepare('SELECT optionId FROM email_mention_options WHERE mentionId = ? ORDER BY optionId').all(id).map((r) => r.optionId);
  assert.deepEqual(mentions.map((m) => m.section), ['local', 'local', 'extras', 'extras', 'extras', 'kids']);
  assert.deepEqual(links(mentions[0].id), [1, 2], 'the juices in one line');
  assert.equal(mentions[0].priceSource, 'option');
  assert.equal(mentions[0].priceOptionId, 1);
  assert.match(mentions[0].offerFr, /Pressoir du Pilat/);
  assert.match(mentions[5].offerFr, /enfants aiment les animaux/);
  const order = JSON.parse(db.prepare('SELECT bookedConfirmationOrder AS v FROM app_settings').get().v);
  const byRole = (n) => `mention:${mentions[n].id}`;
  assert.deepEqual(order, [byRole(4), 'babyBed', 'towels', byRole(2), byRole(0), byRole(1), byRole(3), byRole(5)]);
});

test('rule 24: the resource sentence, the direct platform, the VAPID subject and the extinguisher', () => {
  const db = solio();
  runProductisationMigration(db, { env: {} });
  assert.match(db.prepare('SELECT emailBookedText AS t FROM resources WHERE id = 1').get().t, /bain nordique/);
  assert.equal(db.prepare('SELECT emailBookedText AS t FROM resources WHERE id = 2').get().t, '');
  assert.equal(db.prepare("SELECT countsAsDirect FROM platforms WHERE name = 'lodgify'").get().countsAsDirect, 1);
  assert.equal(db.prepare('SELECT vapidSubject FROM app_settings').get().vapidSubject, 'mailto:contact@domainesolio.com');
  assert.equal(db.prepare("SELECT value FROM plugin_settings WHERE plugin_id = 'sas' AND key = 'extinguisherCheck'").get().value, '1');
});

test('rule 24: an existing « Lodgify » row is marked whatever its case, never doubled', () => {
  const db = solio();
  db.prepare("INSERT INTO platforms (name) VALUES ('Lodgify')").run();
  runProductisationMigration(db, { env: {} });
  assert.deepEqual(db.prepare("SELECT name, countsAsDirect FROM platforms WHERE LOWER(name) = 'lodgify'").all().map((r) => ({ ...r })), [{ name: 'Lodgify', countsAsDirect: 1 }]);
});

test('rule 24: VAPID_SUBJECT set in the environment wins, nothing stored', () => {
  const db = solio();
  runProductisationMigration(db, { env: { VAPID_SUBJECT: 'mailto:x@y.fr' } });
  assert.equal(db.prepare('SELECT vapidSubject FROM app_settings').get().vapidSubject, '');
});

test('rule 25: never twice, never over an operator\'s value', () => {
  const db = solio();
  db.prepare("INSERT INTO stay_texts (key, propertyId, fr, en) VALUES ('bag.items', 0, 'Mon sac', 'My bag')").run();
  db.prepare("UPDATE resources SET emailBookedText = 'Mon bain' WHERE id = 1").run();
  runProductisationMigration(db, { env: {} });
  assert.equal(texts(db)['bag.items'], 'Mon sac');
  assert.equal(db.prepare('SELECT emailBookedText AS t FROM resources WHERE id = 1').get().t, 'Mon bain');
  db.prepare('DELETE FROM stay_texts').run();
  assert.deepEqual(runProductisationMigration(db, { env: {} }), { action: 'skipped' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stay_texts').get().n, 0);
});
