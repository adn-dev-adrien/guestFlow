// specs/settings-input-guards.md rule 54 (audit R22, 2026-11-04) — the prices of « Facturables au SAS » feed a
// departure's bill: a usable number ≥ 0, refused never clamped, on both lists; a stored price sent back passes.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
const registry = require('../../sdk/registry');
const billables = require('../billablesController');

registry.configure({ isActive: () => true, allows: () => true });

function call(fn, body) {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  billables[fn]({ body, params: {}, query: {} }, res);
  return res;
}

const ROUTES = [
  { fn: 'updateLinenItems', table: 'linen_priced_items', item: (price) => ({ label: 'Taie', price, category: 'bed' }) },
  { fn: 'updateRepairAmounts', table: 'repair_amounts', item: (price) => ({ label: 'Vitre', price }) },
];

for (const { fn, table, item } of ROUTES) {
  test(`settings-input-guards rule 54: ${fn} refuses a price that is not a usable number ≥ 0 and keeps the list`, () => {
    assert.equal(call(fn, { items: [item(12.5)] }).statusCode, 200);
    for (const price of [1e999, 1e308, Number.MAX_SAFE_INTEGER + 2, -1, 'abc', '1e999', true, [1], {}]) {
      const res = call(fn, { items: [item(price)] });
      assert.equal(res.statusCode, 400, `${String(price)}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, 'INVALID_PAYLOAD');
      assert.equal(res.body.message, 'Prix : un montant ≥ 0 €.');
      assert.deepEqual(db.prepare(`SELECT price FROM ${table} WHERE label LIKE '%'`).all().filter((r) => r.price > 1e15 || r.price < 0), []);
    }
    assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE price = 12.5`).get().n >= 1);
  });

  test(`settings-input-guards rule 54: ${fn} keeps its blanks, its numeric text and its label-less rows`, () => {
    for (const items of [[item('8.5')], [item(0)], [item('')], [item(null)], [{ ...item(1e308), label: '  ' }], []]) {
      assert.equal(call(fn, { items }).statusCode, 200, JSON.stringify(items));
    }
  });

  test(`settings-input-guards rule 54: ${fn} does not re-judge a stored price sent back unchanged`, () => {
    call(fn, { items: [item(5)] });
    db.prepare(`UPDATE ${table} SET price = 1e300 WHERE price = 5`).run();
    assert.equal(call(fn, { items: [item(1e300)] }).statusCode, 200);
    assert.equal(call(fn, { items: [item(1e301)] }).statusCode, 400);
    call(fn, { items: [] });
  });
}
