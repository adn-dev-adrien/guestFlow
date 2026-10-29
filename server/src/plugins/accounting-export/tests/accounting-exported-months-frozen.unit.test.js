// Keeps the default models off the real database file: parallel files would race on its migration.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// specs/accountant-accounting-export.md rules 33 and 35 — a month the accountant may already have
// imported keeps its cents. Final review 2026-10-18, N4: the rule 32 split moved one cent on April
// (Noailles 624,54 / 62,46), July (Nicolas 40,34 / 11,23) and September 2026 (Van Dyke 117,28 / 11,72).
// Second pass (minor 3): a cutoff fixed at 1 October 2026 would still move October, which production
// may export before this version is installed — the split starts the month after installation.
const { buildRows } = require('../accountingExport');
const { firstOfNextMonth, readTtcSplitFrom, storeTtcSplitFrom, TTC_SPLIT_FALLBACK } = require('../settings');

function entry(paidDate) {
  // 129,00 € of a 150,07 € stay at 10 %, the Van Dyke shape.
  return {
    reservationId: 1, kind: 'balance', paidDate,
    client: { firstName: 'Anna', lastName: 'Van Dyke' },
    platform: 'direct', clientGrossAmount: null,
    finalPrice: 150.07, encaissementTtc: 129, taxTtc: 0, fraction: 0.859599,
    buckets: [{ name: 'accommodation', ht: 136.43, vat: 13.64, ratePercent: 10 }],
  };
}

const credits = (rows) => rows.map((r) => Number(String(r[8]).replace(',', '.'))).filter((v) => v > 0).sort((a, b) => b - a);

test('rule 33 — September and October 2026 keep the cents production exported', () => {
  assert.deepEqual(credits(buildRows([entry('2026-09-28')])), [117.28, 11.72]);
  assert.deepEqual(credits(buildRows([entry('2026-10-31')])), [117.28, 11.72]);
});

test('rule 35 — from the stored cutoff the TTC share is split at its rate', () => {
  const plan = { ttcSplitFrom: '2026-12-01' };
  assert.deepEqual(credits(buildRows([entry('2026-11-30')], plan)), [117.28, 11.72]);
  assert.deepEqual(credits(buildRows([entry('2026-12-01')], plan)), [117.27, 11.73]);
  assert.deepEqual(credits(buildRows([entry('2026-11-01')])), [117.27, 11.73], 'fallback 1 November 2026');
});

test('rule 35 — the migration stores the first day of the month after installation, once', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE plugin_settings (plugin_id TEXT, key TEXT, value TEXT, updated_at TEXT, PRIMARY KEY (plugin_id, key))');
  assert.equal(readTtcSplitFrom(db), TTC_SPLIT_FALLBACK);
  storeTtcSplitFrom(db, new Date(2026, 11, 9));
  assert.equal(readTtcSplitFrom(db), '2027-01-01');
  storeTtcSplitFrom(db, new Date(2027, 4, 2));
  assert.equal(readTtcSplitFrom(db), '2027-01-01', 'a later start never moves it');
  assert.equal(firstOfNextMonth(new Date(2026, 9, 31)), '2026-11-01');
});
