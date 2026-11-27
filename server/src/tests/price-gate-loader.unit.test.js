// specs/pricing/pricing-components.md rule 68 — any difference fails the price gate, and its only exception is the
// versioned allowlist. The synthetic stays and a production capture go through the same `loadInputs`: a branch on the
// kind of set (the `meta` a capture carries) would put the gate on rows a real boot never holds and hide a figure the
// code moves. 2026-11-27: the D20 figures of synthetic booking #4 were hidden that way. Loaded as it is and dressed as a
// capture, each in a fresh database, the synthetic set must leave the same tables.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { skipWithout } = require('../plugins/sdk/testing');

const FIXTURE = path.join(__dirname, 'fixtures', 'price-gate', 'inputs.json');
const LOADER = path.join(__dirname, 'helpers', 'priceGateLoadedTables.js');
const ISOLATE = path.join(__dirname, 'setup', 'isolateDefaultDb.js');
const MARK = 'PRICE_GATE_TABLES ';
const inputs = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : null;
// The synthetic rows hold `resource_bookings` and accounting-export journal rows: skipped in those plugins' removal cells.
const SKIP = skipWithout(['hourly-resources', 'accounting-export']) || (inputs && inputs.meta && inputs.synthetic ? false : 'price-gate fixture absent');

const tablesLoaded = (variant) => {
  const out = execFileSync(process.execPath, ['--require', ISOLATE, LOADER, variant], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.split('\n').find((line) => line.startsWith(MARK)).slice(MARK.length));
};

test('the price gate loads the synthetic set exactly as it loads a capture', { skip: SKIP }, () => {
  assert.deepEqual(tablesLoaded('as-capture'), tablesLoaded('as-is'), 'the loader must not treat a set by its kind');
});
