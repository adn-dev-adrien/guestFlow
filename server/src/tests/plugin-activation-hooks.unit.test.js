// specs/plugin-removal-resilience.md rule 17 — the activation hooks also fire when the licence starts
// allowing a plugin whose row was already enabled, once per off → on transition, and never for the live
// set a boot starts with.

const test = require('node:test');
const assert = require('node:assert/strict');

const loader = require('../plugins/loader');
const registry = require('../plugins/sdk/registry');

function setup({ allowed }) {
  const fired = [];
  const state = { allowed };
  registry.reset();
  loader.resetLiveTransitionsForTests();
  registry.configure({ isActive: () => true, allows: () => state.allowed });
  registry.ensure('fixture-live').onActivate.push(() => { fired.push('fixture-live'); });
  return { fired, state };
}

test('rule 17: a plan upgrade that turns a plugin live fires its activation hook once', async () => {
  const { fired, state } = setup({ allowed: false });
  await loader.syncLiveTransitions();
  assert.deepEqual(fired, [], 'the baseline fires nothing');
  state.allowed = true;
  await loader.syncLiveTransitions();
  assert.deepEqual(fired, ['fixture-live']);
  await loader.syncLiveTransitions();
  assert.deepEqual(fired, ['fixture-live'], 'once per transition');
  state.allowed = false;
  await loader.syncLiveTransitions();
  state.allowed = true;
  await loader.syncLiveTransitions();
  assert.deepEqual(fired, ['fixture-live', 'fixture-live'], 'a second transition fires again');
  registry.reset();
});

test('rule 17: a plugin already live at boot fires nothing, and an explicit activation is not announced twice', async () => {
  const { fired, state } = setup({ allowed: true });
  await loader.syncLiveTransitions();
  assert.deepEqual(fired, []);
  state.allowed = false;
  await loader.syncLiveTransitions();
  state.allowed = true;
  await loader.runActivateHooks('fixture-live');
  await loader.syncLiveTransitions();
  assert.deepEqual(fired, ['fixture-live']);
  registry.reset();
});
