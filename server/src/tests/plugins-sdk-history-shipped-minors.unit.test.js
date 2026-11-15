// specs/plugins-phase-1-sdk.md rule 53 (end review R3-10) — the SDK history records what each SHIPPED minor exposed: v4.1.0 shipped SDK
// 2.27.0 without the VAT and accounting-output modules, so they are recorded under 2.28.0 and a `^2.27.0` plugin never reaches them.
const test = require('node:test');
const assert = require('node:assert/strict');

const history = require('../plugins/sdk/coreModuleHistory.json');

const LATE = ['vat', 'accountingOutput', 'legacyBucketSplit', 'refundJournal', 'csvJournal', 'salesJson', 'synthesisExporter'];

test('rule 53 — the modules v4.1.0 (SDK 2.27.0) did not ship are recorded under 2.28.0', () => {
  const at = (version) => (history.added.find((entry) => entry.version === version) || { modules: [] }).modules;
  assert.deepEqual(at('2.27.0').filter((name) => LATE.includes(name)), []);
  assert.deepEqual(LATE.filter((name) => !at('2.28.0').includes(name)), []);
});
