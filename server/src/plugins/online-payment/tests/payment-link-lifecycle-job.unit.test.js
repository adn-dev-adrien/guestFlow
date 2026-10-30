// specs/payment-link-lifecycle.md rules 16, 22, 23 — the plugin runs the lifecycle pass every 15 minutes, as
// its own job `payment-link-lifecycle`, never while a poll pass runs (one shared in-progress flag), and not at
// all while Qonto is not connected. No provider is reached: the passes are stubs.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPaymentJobs, LIFECYCLE_INTERVAL_MS } = require('../paymentJobs');
const sdk = require('../../sdk');

const quietLog = () => {
  const lines = [];
  return { lines, info: (...a) => lines.push(['info', a.join(' ')]), warn: (...a) => lines.push(['warn', a.join(' ')]), error: (...a) => lines.push(['error', a.join(' ')]) };
};

function jobs({ connected = true, poll, lifecycle } = {}) {
  const log = quietLog();
  const calls = [];
  const list = createPaymentJobs({
    isConnected: () => connected,
    pollIntervalMs: 8 * 60 * 60 * 1000,
    log,
    runPoll: poll || (async () => { calls.push('poll'); return { retired: 0, paid: 0, checked: 0, stoppedBy: null }; }),
    runLifecycle: lifecycle || (async () => { calls.push('lifecycle'); return { moved: [], results: [], stoppedBy: null }; }),
  });
  const byName = Object.fromEntries(list.map((j) => [j.name, j]));
  return { byName, calls, log };
}

test('rule 16 — the lifecycle job runs every 15 minutes, first at 15 minutes; the poll keeps its 8 h and 110 s', () => {
  const { byName } = jobs();
  assert.equal(LIFECYCLE_INTERVAL_MS, 15 * 60 * 1000);
  assert.deepEqual(Object.keys(byName).sort(), ['payment-link-lifecycle', 'payment-poll']);
  assert.equal(byName['payment-link-lifecycle'].intervalMs, 15 * 60 * 1000);
  assert.equal(byName['payment-link-lifecycle'].bootDelayMs, 15 * 60 * 1000);
  assert.equal(byName['payment-poll'].intervalMs, 8 * 60 * 60 * 1000);
  assert.equal(byName['payment-poll'].bootDelayMs, 110 * 1000);
});

test('rule 22 — the lifecycle job skips while a poll pass runs', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const { byName } = jobs({
    poll: async () => { calls.push('poll'); await held; return { retired: 0, paid: 0, checked: 0, stoppedBy: null }; },
    lifecycle: async () => { calls.push('lifecycle'); return { moved: [], results: [], stoppedBy: null }; },
  });
  const running = byName['payment-poll'].run();
  await byName['payment-link-lifecycle'].run();
  assert.deepEqual(calls, ['poll'], 'skipped during the poll');
  release();
  await running;
  await byName['payment-link-lifecycle'].run();
  assert.deepEqual(calls, ['poll', 'lifecycle']);
});

// Review of #894, item 3 — rule 22 lets only the lifecycle job skip: a poll tick that meets a running
// lifecycle pass waits for it, then runs, instead of losing 8 hours.
test('rule 22 — the poll waits for a running lifecycle pass, then runs', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const { byName } = jobs({
    poll: async () => { calls.push('poll'); return { retired: 0, paid: 0, checked: 0, stoppedBy: null }; },
    lifecycle: async () => { calls.push('lifecycle'); await held; return { moved: [], results: [], stoppedBy: null }; },
  });
  const lifecycle = byName['payment-link-lifecycle'].run();
  const poll = byName['payment-poll'].run();
  await Promise.resolve();
  assert.deepEqual(calls, ['lifecycle'], 'the poll does not overlap the pass');
  release();
  await Promise.all([lifecycle, poll]);
  assert.deepEqual(calls, ['lifecycle', 'poll']);
});

test('rule 22 — a failing pass releases the flag and is logged; the next run goes ahead', async () => {
  let fail = true;
  const calls = [];
  const { byName, log } = jobs({
    lifecycle: async () => { calls.push('lifecycle'); if (fail) throw new Error('db locked'); return { moved: [], results: [], stoppedBy: null }; },
  });
  await byName['payment-link-lifecycle'].run();
  fail = false;
  await byName['payment-link-lifecycle'].run();
  assert.deepEqual(calls, ['lifecycle', 'lifecycle']);
  assert.deepEqual(log.lines[0], ['error', 'lifecycle pass error: db locked']);
});

test('rule 23 — Qonto not connected: neither job runs, nothing is deactivated nor read', async () => {
  const { byName, calls } = jobs({ connected: false });
  await byName['payment-link-lifecycle'].run();
  await byName['payment-poll'].run();
  assert.deepEqual(calls, []);
});

test('rule 16 — what the job moved and where a rate limit stopped it is logged', async () => {
  const { byName, log } = jobs({ lifecycle: async () => ({ moved: [{ id: 1 }, { id: 2 }], results: [], stoppedBy: 'rate-limit' }) });
  await byName['payment-link-lifecycle'].run();
  assert.deepEqual(log.lines, [['info', '2 link(s) lapsed or withdrawn'], ['warn', 'lifecycle pass stopped by rate-limit; the rest wait for the next run']]);
});

// specs/plugins-phase-1-sdk.md rule 35 — the pass reaches the plugin as a core module name of SDK 2.18.0.
test('plugins-phase-1-sdk rule 35 — `paymentPollRunner.runLinkLifecycle` is in the contract, and the plugin asks for SDK 2.18', () => {
  assert.equal(typeof sdk.coreModule('paymentPollRunner').runLinkLifecycle, 'function');
  assert.equal(require('../manifest.json').sdk, '^2.18.0');
  assert.equal(require('../../sdk/version').SDK_VERSION, '2.18.0');
});
