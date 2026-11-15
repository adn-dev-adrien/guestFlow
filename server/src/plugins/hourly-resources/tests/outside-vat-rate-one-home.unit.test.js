// specs/outside-booking-sas.md rule 28, pricing-components rules 61, 88 (loop t1 B-3) — the outside rate of a session has one home: the catalogue's
// `resources` rate once typed, else the plugin's « TVA des ventes hors séjour »; the core's settings provider reads the same.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { outsideVatRateOf } = require('../settings');
const settingsProvider = require('../../../models/ports/settingsProvider');

test('B-3 — the plugin and the core read the same outside rate, before and after a catalogue rate is typed', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE plugins (id TEXT PRIMARY KEY); INSERT INTO plugins (id) VALUES ('hourly-resources');
    CREATE TABLE plugin_settings (plugin_id TEXT, key TEXT, value TEXT); INSERT INTO plugin_settings VALUES ('hourly-resources', 'standaloneVatRate', '20');
    CREATE TABLE vat_external_rates (vatClass TEXT PRIMARY KEY, rate REAL NOT NULL);`);
  const core = () => settingsProvider.create(db).for('vat', {})['vat.rate.resources.external'];
  assert.deepEqual([outsideVatRateOf(db, () => 20), core()], [20, 20]);
  db.prepare("INSERT INTO vat_external_rates (vatClass, rate) VALUES ('resources', 10)").run();
  assert.deepEqual([outsideVatRateOf(db, () => 20), core()], [10, 10]);
  assert.equal(outsideVatRateOf(new Database(':memory:'), () => 5.5), 5.5, 'no table: the setting');
});
