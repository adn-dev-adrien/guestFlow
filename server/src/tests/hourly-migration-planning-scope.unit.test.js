// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 4 — the migration that makes every price explicit drops a per-lodging price only on an hourly resource of the planning:
// a per_hour resource with no planning card keeps its per-lodging prices.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const { explicitHourlyRates } = optionalPlugin(() => require('../plugins/hourly-resources/migrations'));

test('a per-lodging price survives on a per_hour resource without a planning card, and is dropped (and logged) on one with', { skip: skipWithout(['hourly-resources']) }, (t) => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, price REAL, priceType TEXT, showsPlanningCard INTEGER, hourlyEveningRate REAL, hourlyExternalDayRate REAL, hourlyExternalEveningRate REAL,
      hourlyNextDayRate REAL, hourlyNextEveningRate REAL, hourlyExternalNextDayRate REAL, hourlyExternalNextEveningRate REAL);
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));`);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Estiva')").run();
  db.prepare("INSERT INTO resources (id, name, price, priceType, showsPlanningCard) VALUES (1, 'Bain', 40, 'per_hour', 1), (2, 'Location de vélo', 12, 'per_hour', 0)").run();
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (1, 1, 30, 60), (1, 2, 9, 0)').run();
  const lines = [];
  t.mock.method(console, 'log', (line) => lines.push(String(line)));
  explicitHourlyRates(db);
  assert.equal(db.prepare('SELECT price FROM property_resource_prices WHERE resourceId = 1').get().price, null);
  assert.equal(db.prepare('SELECT price FROM property_resource_prices WHERE resourceId = 2').get().price, 9);
  assert.equal(lines.filter((line) => /lodging/.test(line)).length, 1);
  assert.match(lines.find((line) => /lodging/.test(line)), /"Bain"/);
});
