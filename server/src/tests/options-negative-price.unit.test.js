// specs/public-api.md rule 14 (2026-10-27 audit) — no catalogue option sells at a negative price: a
// reduction is a price adjustment or a refund. The admin API refuses one, in French.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-option-negative-')), 'g.db');
const db = require('../database');
const controller = require('../controllers/optionsController');

function res() {
  return { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test('create refuses a negative price and writes nothing', () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM options').get().n;
  const r = res();
  controller.create({ body: { title: 'Remise', priceType: 'per_stay', price: -50 } }, r);
  assert.equal(r.statusCode, 422);
  assert.deepEqual(r.body.details.map((d) => [d.field, d.code]), [['price', 'NEGATIVE_OPTION_PRICE']]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, before);
});

test('update refuses a negative price; a zero price and an update without price go through', () => {
  const id = db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Ménage', 'per_stay', 80)").run().lastInsertRowid;
  const refused = res();
  controller.update({ params: { id }, body: { title: 'Ménage', priceType: 'per_stay', price: '-1' } }, refused);
  assert.equal(refused.statusCode, 422);
  assert.equal(db.prepare('SELECT price FROM options WHERE id = ?').get(id).price, 80);
  const free = res();
  controller.update({ params: { id }, body: { title: 'Ménage', priceType: 'per_stay', price: 0 } }, free);
  assert.equal(free.statusCode, 200);
});
