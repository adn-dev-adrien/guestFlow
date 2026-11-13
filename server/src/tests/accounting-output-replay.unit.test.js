// specs/pricing-components.md §3 rules 63, 64 and 65 — the accounting output is a MOVE: every month of the golden database
// leaves the same CSV bytes (latin-1, as the route writes them), the same sales JSON and the same synthesis (month windows and
// whole years) as before the entry builders became `AccountingOutput` and the writers became exporters. The expected hashes
// were captured on the code before the move; `ACCOUNTING_OUTPUT_UPDATE=1` rewrites them, which is only ever legitimate on
// code that is known to answer as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { skipWithout } = require('../plugins/sdk/testing');
const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');
const { accountingOutputHashes } = require('./accountingOutputFixture');

const BASELINE = path.join(__dirname, 'fixtures', 'accounting-output', 'baseline.json');

test('rules 63-65: every month CSV, sales JSON and synthesis of the golden database is byte-identical', { skip: skipWithout(['accounting-export']) }, async () => {
  const db = buildVatGoldenDb();
  const { actual, nonEmptyMonths } = accountingOutputHashes(db);
  if (process.env.ACCOUNTING_OUTPUT_UPDATE === '1') {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, `${JSON.stringify(actual, null, 1)}\n`);
    return;
  }
  const expected = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const key of Object.keys(expected)) assert.equal(actual[key], expected[key], key);
  assert.ok(nonEmptyMonths >= 5, `the golden database must feed the journal (${nonEmptyMonths} months)`);
});
