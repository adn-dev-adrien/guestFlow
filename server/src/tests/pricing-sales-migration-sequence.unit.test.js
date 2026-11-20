// specs/pricing-components.md §3 rule 36, §5 T4/T5 (end review R1-5) — a rebuilt table keeps its AUTOINCREMENT counter as an INTEGER: the
// counter is bound as an integer, never stored as a REAL (`85.0`).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runPricingSalesMigration } = require('../utils/pricingSalesMigration');
const { oldDatabase, seed } = require('./pricingSalesFixtures');

test('rule 36 — the counters of payment_links and email_log stay integers through the rebuild', () => {
  const db = oldDatabase();
  seed(db);
  // The last rows were deleted: the counter is above every row left, so the rebuild has to put it back (prod: email_log at 85).
  db.prepare('DELETE FROM email_log WHERE id = (SELECT MAX(id) FROM email_log)').run();
  db.prepare("DELETE FROM payment_links WHERE id = (SELECT MAX(id) FROM payment_links)").run();
  const before = db.prepare("SELECT name, seq FROM sqlite_sequence WHERE name IN ('payment_links', 'email_log') ORDER BY name").all();
  runPricingSalesMigration(db);
  const after = db.prepare("SELECT name, seq, typeof(seq) AS type FROM sqlite_sequence WHERE name IN ('payment_links', 'email_log') ORDER BY name").all();
  assert.deepEqual(after.map((row) => row.type), ['integer', 'integer']);
  assert.deepEqual(after.map((row) => [row.name, row.seq]), before.map((row) => [row.name, row.seq]));
});
