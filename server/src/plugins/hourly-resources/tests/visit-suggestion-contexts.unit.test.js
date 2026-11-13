// specs/outside-booking-sas.md rule 37 — the plugin supplies the CONTEXTS of the kind `resource` to the generic « Proposés à l'arrivée » lists: the resources sold by the hour
// and placed on a planning, listed when asked, in name order; the per-resource list itself is the core's `suggested_articles` rows, never a setting of this plugin.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const plugin = require('..');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const { SETTINGS } = require('../settings');

const db = new Database(':memory:');
db.exec(`CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, priceType TEXT DEFAULT 'per_stay', showsPlanningCard INTEGER DEFAULT 0)`);
db.prepare("INSERT INTO resources (name, priceType, showsPlanningCard) VALUES ('Sauna', 'per_hour', 1), ('Bain nordique', 'per_hour', 1), ('Vélo', 'per_stay', 0), ('Salle', 'per_hour', 0)").run();

test('rule 37 — the resources sold by the hour and placed on a planning are the contexts of the kind « resource »', () => {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  plugin.register(createContext(plugin.id, { db }));
  const [declared] = registry.get(plugin.id).suggestionContexts;
  assert.equal(declared.kind, 'resource');
  assert.equal(declared.label, 'Ressources à l’heure');
  assert.deepEqual(declared.list().map((c) => c.label), ['Bain nordique', 'Sauna'], 'by name, only what a visit can book');
  registry.reset();
});

test('rule 37 — no per-resource article list in the plugin\'s settings', () => {
  assert.deepEqual(SETTINGS.map((s) => s.key), ['standaloneVatRate']);
});

test('rule 37 — a database without the resources table lists nothing, never fails', () => {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  plugin.register(createContext(plugin.id, { db: new Database(':memory:') }));
  assert.deepEqual(registry.get(plugin.id).suggestionContexts[0].list(), []);
  registry.reset();
});
