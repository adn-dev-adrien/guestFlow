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
  assert.match(config, /from '\.\/vitest\.config\.js'/);
  assert.match(config, /setupSlowScheduler\.js/);
});

test('rule 11: the setup delays every setImmediate by SCHED_DELAY ms, 8 by default', () => {
  const source = read('src/setupSlowScheduler.js');
  const calls = [];
  const sandbox = {
    process: { env: {} },
    globalThis: { setTimeout: (fn, ms) => calls.push(ms) },
  };
  new Function('globalThis', 'process', source)(sandbox.globalThis, sandbox.process);
  sandbox.globalThis.setImmediate(() => {});
  sandbox.process.env.SCHED_DELAY = '2';
  new Function('globalThis', 'process', source)(sandbox.globalThis, sandbox.process);
  sandbox.globalThis.setImmediate(() => {});
  assert.deepEqual(calls, [8, 2]);
});

test('rule 11: the setup is never part of the normal suite nor of CI', () => {
  assert.doesNotMatch(read('vitest.config.js'), /setupSlowScheduler/);
  const workflows = path.join(clientDir, '..', '.github', 'workflows');
  const files = fs.readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name));
  assert.ok(files.length > 0);
  for (const name of files) {
    assert.doesNotMatch(fs.readFileSync(path.join(workflows, name), 'utf8'), /slow-scheduler|setupSlowScheduler/, name);
  }
});
