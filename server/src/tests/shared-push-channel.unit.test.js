// specs/site/site-outside-resource-booking.md rules 22, 24 — a push channel several plugins may declare: every declaration carries the same key and label and `shared: true`; the toggle is
// listed once while any declaring plugin is live; a mismatched label or a declaration that is not shared is refused; a non-shared key stays unique.
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-shared-push-')), 'p.db');

const test = require('node:test');
const assert = require('node:assert/strict');

const silent = console.log;
console.log = () => {};
const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const { availablePushChannels, isDeclaredPushChannel } = require('../utils/pushChannels');
console.log = silent;

let live = new Set();
const channel = { key: 'online-sales', label: 'Bons cadeaux et séances en ligne', shared: true };

test('rule 24 — two plugins declare one shared channel; a differing label, a missing `shared` or a third plugin’s unshared declaration is refused', () => {
  registry.reset();
  registry.configure({ isActive: (id) => live.has(id), allows: () => true });
  createContext('vouchers', {}).pushChannel(channel);
  createContext('sessions', {}).pushChannel(channel);
  assert.throws(() => createContext('third', {}).pushChannel({ ...channel, label: 'Autre libellé' }), /already declared/);
  assert.throws(() => createContext('third', {}).pushChannel({ key: channel.key, label: channel.label }), /already declared/);
  assert.throws(() => createContext('third', {}).pushChannel({ key: 'arrivals', label: 'x', shared: true }), /already declared/);
  createContext('third', {}).pushChannel(channel);
});

test('rule 22 — the toggle is listed once while either plugin is live, and not at all when neither is', () => {
  const listed = () => availablePushChannels().filter((c) => c.key === 'online-sales');
  live = new Set(['vouchers']);
  assert.deepEqual(listed(), [{ key: 'online-sales', label: 'Bons cadeaux et séances en ligne' }]);
  live = new Set(['vouchers', 'sessions', 'third']);
  assert.equal(listed().length, 1, 'declared by three live plugins, listed once');
  live = new Set(['sessions']);
  assert.equal(listed().length, 1);
  live = new Set();
  assert.deepEqual(listed(), []);
  assert.equal(isDeclaredPushChannel('online-sales'), true, 'a send still names a channel someone can switch off');
});

test('rule 24 — a channel that is not shared stays unique, as before', () => {
  registry.reset();
  createContext('insurer', {}).pushChannel({ key: 'insurer', label: 'Souscriptions' });
  assert.throws(() => createContext('other', {}).pushChannel({ key: 'insurer', label: 'Souscriptions' }), /already declared/);
  assert.throws(() => createContext('other', {}).pushChannel({ key: 'insurer', label: 'Souscriptions', shared: true }), /already declared/);
  assert.throws(() => createContext('insurer2', {}).pushChannel({ key: 'insurer', label: 'Souscriptions', shared: false }), /already declared/);
});
