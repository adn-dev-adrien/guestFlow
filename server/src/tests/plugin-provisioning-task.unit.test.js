// specs/plugin-operator-provisioning.md rule 16 — the task runs a pass at boot and then every minute, and a
// failing pass never stops the next one.
const test = require('node:test');
const assert = require('node:assert/strict');

const { start, TICK_MS, BOOT_DELAY_MS } = require('../tasks/pluginProvisioning');

test('rule 16: one pass after the boot delay, then one per minute', async () => {
  const timers = [];
  let runs = 0;
  start({
    reconciler: { run: async () => { runs += 1; } },
    setIntervalFn: (fn, ms) => timers.push(['interval', ms, fn]),
    setTimeoutFn: (fn, ms) => timers.push(['timeout', ms, fn]),
  });
  assert.deepEqual(timers.map(([kind, ms]) => [kind, ms]), [['interval', TICK_MS], ['timeout', BOOT_DELAY_MS]]);
  assert.equal(TICK_MS, 60 * 1000);
  await timers[1][2]();
  await timers[0][2]();
  assert.equal(runs, 2);
});

test('rule 16: a pass that throws is logged and the next one still runs', async () => {
  const timers = [];
  let calls = 0;
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const pass = start({
      reconciler: { run: async () => { calls += 1; if (calls === 1) throw new Error('disk full'); } },
      setIntervalFn: (fn) => timers.push(fn),
      setTimeoutFn: (fn) => timers.push(fn),
    });
    await pass();
    await pass();
  } finally { console.error = original; }
  assert.equal(calls, 2);
  assert.match(errors[0], /disk full/);
});
