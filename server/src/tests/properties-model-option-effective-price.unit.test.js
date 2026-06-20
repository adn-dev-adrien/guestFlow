const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const propertiesModel = require('../models/propertiesModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

// specs/per-property-option-prices.md — the reservation fiche reads `property.options` from
// getByIdWithDetails; each option must carry its EFFECTIVE price for THAT property (the per-property
// override when set, else the base price), so the displayed unit price matches the pricing engine.
function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte A'), (2, 'Gîte B')").run();
  // One option, base price 40, linked to both properties; property 1 overrides it to 60.
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (9, 'Ménage', 'per_stay', 40)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 9), (2, 9)').run();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (1, 9, 60)').run();
  return db;
}

test('getByIdWithDetails exposes options with the per-property EFFECTIVE price (override wins)', () => {
  const db = freshDb();
  const model = propertiesModel.buildModel(db);

  const p1 = model.getByIdWithDetails(1);
  const opt1 = (p1.options || []).find((o) => o.id === 9);
  assert.ok(opt1, 'option is exposed on property 1');
  assert.equal(opt1.price, 60, 'property 1 sees its per-property override (60), not the base 40');

  const p2 = model.getByIdWithDetails(2);
  const opt2 = (p2.options || []).find((o) => o.id === 9);
  assert.ok(opt2, 'option is exposed on property 2');
  assert.equal(opt2.price, 40, 'property 2 has no override → base price (40)');
});
