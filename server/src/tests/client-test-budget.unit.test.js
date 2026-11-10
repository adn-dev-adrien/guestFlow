// specs/server-test-isolation.md rule 17 (verification R36b) — the client suites share one budget on a loaded runner:
// a 30 s `testTimeout` for every Vitest test and a 5 s wait for every Testing Library `findBy*` / `waitFor`, set once,
// instead of per-test overrides that left the other dialog suites at Vitest's 5 s and Testing Library's 1 s.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { skipWithout } = require('../plugins/sdk/testing');

const clientDir = path.join(__dirname, '..', '..', '..', 'client');
const read = (file) => fs.readFileSync(path.join(clientDir, file), 'utf8');

const RULE_16_FILES = [
  'src/plugins/hourly-resources/__tests__/ResourceBookingDialog.created-id.test.jsx',
  'src/plugins/hourly-resources/__tests__/ResourceBookingDialog.payment-refused.test.jsx',
  'src/plugins/hourly-resources/__tests__/ResourceBookingDialog.paid-actions.test.jsx',
  'src/plugins/hourly-resources/__tests__/ResourceArrivalDialog.paid-before.test.jsx',
  'src/plugins/hourly-resources/__tests__/ResourceArrivalDialog.no-unasked-invoice.test.jsx',
  'src/plugins/hourly-resources/__tests__/ResourceArrivalDialog.test.jsx',
  'src/pages/__tests__/ClientsPage.stale-impact.test.jsx',
];

test('rule 17 — vitest.config.js gives every test 30 s; the race-sweep config inherits it', () => {
  assert.match(read('vitest.config.js'), /^\s*testTimeout: 30000,$/m);
  assert.match(read('vitest.slow-scheduler.config.js'), /\.\.\.base\.test/);
});

test('rule 17 — setupTests.js gives every Testing Library wait 5 s', () => {
  const setup = read('src/setupTests.js');
  assert.match(setup, /import \{ configure \} from '@testing-library\/react';/);
  assert.match(setup, /^configure\(\{ asyncUtilTimeout: 5000 \}\);$/m);
});

// The hourly-resources files go with their plugin (plugin-removal-resilience rules 3, 4).
test('rule 17 — the rule-16 files carry no per-test timeout below the budget', { skip: skipWithout(['hourly-resources']) }, () => {
  for (const file of RULE_16_FILES) {
    assert.doesNotMatch(read(file), /\}, \d+\);\s*$/m, file);
  }
});

// Verification R36b-core N1: an explicit per-test timeout wins over the budget, so one below 30 s gives that test less
// time than every unmarked one. Read across the whole client tree, not a list.
test('rule 17 — no client test sets a per-test timeout below the 30 s budget', () => {
  const below = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); continue; }
      if (!/\.test\.jsx?$/.test(entry.name)) continue;
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const m = /^\}, (\d+)\);\s*$/.exec(line);
        if (m && Number(m[1]) < 30000) below.push(`${path.relative(clientDir, full)}:${i + 1}`);
      });
    }
  };
  walk(path.join(clientDir, 'src'));
  assert.deepEqual(below, []);
});
