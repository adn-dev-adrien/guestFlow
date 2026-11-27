// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 13 — the migration moves a campaign's validity to the short list (3, 6, 12, 18, 24 months): the nearest value, a tie going up
// (a validity is never shortened), one line of the log per campaign changed, a campaign already on the list untouched.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { MIGRATIONS } = require('../migrations');

const step = MIGRATIONS.find((m) => m.name === 'gift_voucher_week_weekend_v5');

function database(validities) {
  const db = new Database(':memory:');
  MIGRATIONS.filter((m) => m !== step).forEach((m) => m.up(db));
  db.prepare('DELETE FROM gift_voucher_campaigns').run();
  validities.forEach((validityMonths, index) => db.prepare("INSERT INTO gift_voucher_campaigns (name, title, kind, slug, validityMonths, createdAt, updatedAt) VALUES (?, 'T', 'lodging', ?, ?, 'x', 'x')").run(`Campagne ${index + 1}`, `c-${index + 1}`, validityMonths));
  return db;
}

test('the nearest allowed value, a tie going up, and one log line per campaign changed', (t) => {
  const lines = [];
  t.mock.method(console, 'log', (line) => lines.push(String(line)));
  const db = database([1, 2, 4, 5, 9, 15, 21, 36, 120, 12, 3]);
  step.up(db);
  const after = db.prepare('SELECT validityMonths FROM gift_voucher_campaigns ORDER BY id').all().map((r) => r.validityMonths);
  assert.deepEqual(after, [3, 3, 3, 6, 12, 18, 24, 24, 24, 12, 3]);
  const logged = lines.filter((line) => /validity/.test(line));
  assert.equal(logged.length, 9, 'the two campaigns already on the list are not logged');
  assert.match(logged[4], /Campagne 5.*9 months is now 12 months/);
});
