// specs/pricing-components.md §3 rules 50 and 53 — `sellableExternally` is a catalogue column read into the article's config, default false;
// `vat.rate.resources.external` is the hourly-resources plugin's « TVA des ventes hors séjour », answered by the settings provider.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { makeArticle } = require('../utils/pricing/articles');
const settingsProvider = require('../models/ports/settingsProvider');

test('rule 53: an article is sellable outside a stay only when its catalogue row says so', () => {
  assert.equal(makeArticle({ id: 1, title: 'Cidre', price: 5 }, { kind: 'option' }).config.sellableExternally, false);
  assert.equal(makeArticle({ id: 1, title: 'Cidre', price: 5, sellableExternally: 1 }, { kind: 'option' }).config.sellableExternally, true);
  assert.equal(makeArticle({ id: 2, name: 'Bain', price: 20, sellableExternally: 0 }, { kind: 'resource' }).config.sellableExternally, false);
});

function settingsDb(rows, plugins = ['hourly-resources']) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE plugin_settings (plugin_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (plugin_id, key)); CREATE TABLE plugins (id TEXT PRIMARY KEY)');
  plugins.forEach((id) => db.prepare('INSERT INTO plugins (id) VALUES (?)').run(id));
  rows.forEach(([key, value]) => db.prepare("INSERT INTO plugin_settings (plugin_id, key, value) VALUES ('hourly-resources', ?, ?)").run(key, value));
  return db;
}
const external = (db) => settingsProvider.create(db).for('vat', {})['vat.rate.resources.external'];

test('rule 50: the external rate of resources is the plugin\'s setting, 20 % while never saved, the regime\'s when the plugin is absent', () => {
  assert.equal(external(settingsDb([['standaloneVatRate', '10']])), 10);
  assert.equal(external(settingsDb([['standaloneVatRate', '5,5']])), 5.5);
  assert.equal(external(settingsDb([])), 20);
  assert.equal(external(settingsDb([['standaloneVatRate', 'abc']])), 20, 'an invalid stored value falls back like the plugin does');
  assert.equal(external(settingsDb([], [])), null, 'no plugin, no rate: the regime answers');
});

test('rule 50: no other rate key is supplied by the adapter', () => {
  const vat = settingsProvider.create(settingsDb([['standaloneVatRate', '10']])).for('vat', {});
  assert.deepEqual(Object.entries(vat).filter(([, v]) => v !== null).map(([k]) => k), ['vat.rate.resources.external']);
});
