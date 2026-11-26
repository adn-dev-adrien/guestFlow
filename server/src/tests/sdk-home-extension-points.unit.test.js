// specs/guest-app/guest-app-home-automation.md §4.1 — the two extension points of SDK 2.28.0: the Sowel connector declares the
// house's data (`homeData`), the guest app declares which readings the lodgings use (`homeSelection`). Plugins never
// import each other; the core hands each out to the other.
const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const sdk = require('../plugins/sdk');

const provider = () => ({
  channel: () => ({}),
  catalog: () => [],
  readings: () => [],
  series: () => [],
  queueCommand: () => ({}),
  confirmed: () => [],
  command: () => null,
});

function live(isActive = () => true) {
  registry.reset();
  registry.configure({ isActive, allows: () => true });
  return () => registry.reset();
}

test('homeData refuses a provider missing a member', (t) => {
  t.after(live());
  const partial = provider();
  delete partial.queueCommand;
  assert.throws(() => createContext('gate-access', {}).homeData(partial), /lacks "queueCommand"/);
});

test('homeData is one per instance', (t) => {
  t.after(live());
  createContext('gate-access', {}).homeData(provider());
  assert.throws(() => createContext('other', {}).homeData(provider()), /already declared by gate-access/);
});

test('the core hands out the live provider, and null when its plugin is inactive', (t) => {
  const active = new Set(['gate-access']);
  t.after(live((id) => active.has(id)));
  const declared = provider();
  createContext('gate-access', {}).homeData(declared);
  assert.equal(sdk.core.homeData(), declared);
  active.clear();
  assert.equal(sdk.core.homeData(), null);
});

test('homeSelection: a function, one per instance, read through the core', (t) => {
  t.after(live());
  assert.throws(() => createContext('guest-app', {}).homeSelection([]), /needs a function/);
  createContext('guest-app', {}).homeSelection(() => [{ equipmentId: 'wx', alias: 'temperature' }]);
  assert.throws(() => createContext('other', {}).homeSelection(() => []), /already declared by guest-app/);
  assert.deepEqual(sdk.core.homeSelection(), [{ equipmentId: 'wx', alias: 'temperature' }]);
});

test('homeSelection: none declared, or a declarer that throws, asks for nothing', (t) => {
  t.after(live());
  assert.deepEqual(sdk.core.homeSelection(), []);
  createContext('guest-app', {}).homeSelection(() => { throw new Error('boom'); });
  const original = console.error;
  console.error = () => {};
  t.after(() => { console.error = original; });
  assert.deepEqual(sdk.core.homeSelection(), []);
});
