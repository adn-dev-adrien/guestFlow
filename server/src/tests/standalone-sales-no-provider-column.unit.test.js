// specs/sas/outside-booking-sas.md §5 and the plugin boundary (end review R3-9) — the core table of the sales outside a stay names no payment or
// invoicing provider: no `qonto*` column.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');

test('§5 — standalone_sales has no provider column', () => {
  const columns = db.prepare('PRAGMA table_info(standalone_sales)').all().map((c) => c.name);
  assert.ok(columns.includes('invoiceNumber'), 'the provider-neutral invoice columns stay');
  assert.deepEqual(columns.filter((name) => /qonto/i.test(name)), []);
});
