// specs/server-test-isolation.md rule 11 — the client race sweep stays runnable.
// Audit R10 M-1: VatRegimeSwitchDialog.switch.test.jsx asserted a callback fired by a passive effect
// right after `findByText`, and turned the inte/plugins head red on GitHub CI. Delaying React's
// scheduler tasks replays that busy runner every time; this pins the sweep that does it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const clientDir = path.join(__dirname, '..', '..', '..', 'client');
const read = (file) => fs.readFileSync(path.join(clientDir, file), 'utf8');

test('rule 11: `npm run test:slow-scheduler` runs the unit suite with the slowed scheduler', () => {
  const { scripts } = JSON.parse(read('package.json'));
  assert.equal(scripts['test:slow-scheduler'], 'vitest run --config vitest.slow-scheduler.config.js');
  const config = read('vitest.slow-scheduler.config.js');
  assert.match(config, /import base from '\.\/vitest\.config\.js'/);
  assert.match(config, /setupFiles: \['\.\/src\/setupSlowScheduler\.js', \.\.\.\(base\.test\?\.setupFiles \|\| \[\]\)\]/);
});

test('rule 11: the setup delays every setImmediate by SCHED_DELAY ms, 2 by default', () => {
  const source = read('src/setupSlowScheduler.js');
  const calls = [];
  const sandbox = {
    process: { env: {} },
    globalThis: { setTimeout: (fn, ms) => calls.push(ms) },
  };
  new Function('globalThis', 'process', source)(sandbox.globalThis, sandbox.process);
  sandbox.globalThis.setImmediate(() => {});
  sandbox.process.env.SCHED_DELAY = '8';
  new Function('globalThis', 'process', source)(sandbox.globalThis, sandbox.process);
  sandbox.globalThis.setImmediate(() => {});
  assert.deepEqual(calls, [2, 8]);
});

test('rule 11: the setup is never part of the normal suite', () => {
  assert.doesNotMatch(read('vitest.config.js'), /setupSlowScheduler/);
});

test('rule 11: the onStale post-condition of the VAT dialog is awaited', () => {
  const suite = read('src/components/__tests__/VatRegimeSwitchDialog.switch.test.jsx');
  assert.match(suite, /await waitFor\(\(\) => expect\(onStale\)\.toHaveBeenCalled\(\)\)/);
  assert.doesNotMatch(suite, /^\s*expect\(onStale\)\.toHaveBeenCalled\(\);/m);
});
