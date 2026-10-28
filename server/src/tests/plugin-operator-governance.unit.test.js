// specs/plugin-operator-provisioning.md rules 1, 2, 15, 21 — who manages the plugins of a space, and
// what the licence says the operator wants running.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { createLicenceReader, signLicence } = require('../utils/licence');
const { operatorManaged, desiredPlugins, pendingEraseOrders } = require('../utils/pluginGovernance');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const NOW = new Date('2026-10-28T10:00:00Z');

function reader(extra = {}, { managed = false, expired = false, withFile = true } = {}) {
  const payload = {
    slug: 'gite-test', plan: 'pro', planName: 'Pro', plugins: ['linen', 'sas', 'online-payment'], state: 'active',
    issuedAt: '2026-10-28T08:00:00.000Z',
    expiresAt: expired ? '2026-10-20T08:00:00.000Z' : '2026-11-04T08:00:00.000Z',
    ...extra,
  };
  const token = signLicence(payload, privateKey);
  return createLicenceReader({
    dataDir: '/x', publicKey, managed, now: () => NOW,
    readFile: () => { if (!withFile) throw Object.assign(new Error('nope'), { code: 'ENOENT' }); return token; },
  });
}

test('rule 1: the hosting environment makes the space operator-managed, with or without a licence', () => {
  assert.equal(operatorManaged({ env: { GUESTFLOW_MANAGED: '1' }, licence: reader({}, { managed: true }) }), true);
  assert.equal(operatorManaged({ env: { GUESTFLOW_MANAGED: '1' }, licence: reader({}, { managed: true, withFile: false }) }), true);
});

test('rule 1: a licence carrying activePlugins makes an unmanaged space operator-managed', () => {
  assert.equal(operatorManaged({ env: {}, licence: reader({ activePlugins: ['linen'] }) }), true);
  assert.equal(operatorManaged({ env: {}, licence: reader({ activePlugins: [] }) }), true);
});

test('rule 1: no environment flag and no activePlugins → self-managed (Solio, development, E2E)', () => {
  assert.equal(operatorManaged({ env: {}, licence: reader({}) }), false);
  assert.equal(operatorManaged({ env: {}, licence: reader({}, { withFile: false }) }), false);
  assert.equal(operatorManaged({ env: { GUESTFLOW_MANAGED: '0' }, licence: reader({}) }), false);
});

test('rule 2: nothing inside the space moves the decision — a forged licence carries no activePlugins', () => {
  const forged = createLicenceReader({
    dataDir: '/x', publicKey, now: () => NOW,
    readFile: () => signLicence({ slug: 'a', plugins: [], activePlugins: ['linen'], state: 'active', expiresAt: '2027-01-01T00:00:00Z' }, crypto.generateKeyPairSync('ed25519').privateKey),
  });
  assert.equal(forged.activePlugins(), null);
  assert.equal(operatorManaged({ env: {}, licence: forged }), false);
});

test('rule 15: activePlugins is the desire, in the licence order', () => {
  assert.deepEqual(desiredPlugins(reader({ activePlugins: ['sas', 'linen'] })), ['sas', 'linen']);
});

test('rule 15: a licence without activePlugins desires nothing — the stored states stand', () => {
  assert.equal(desiredPlugins(reader({})), null);
});

test('rule 21: activePlugins is intersected with plugins — it never revives a plugin outside the plan', () => {
  assert.deepEqual(desiredPlugins(reader({ activePlugins: ['linen', 'neat', 'sas'] })), ['linen', 'sas']);
});

test('rule 15: an expired licence keeps its activePlugins, as it keeps its plugins', () => {
  const lic = reader({ activePlugins: ['linen'], eraseOrders: [{ order: 'o1', id: 'sas' }] }, { expired: true });
  assert.deepEqual(desiredPlugins(lic), ['linen']);
  assert.deepEqual(pendingEraseOrders(lic), [{ order: 'o1', id: 'sas' }]);
  assert.equal(lic.issuedAt(), '2026-10-28T08:00:00.000Z');
});

test('rule 23: malformed erase orders are ignored', () => {
  assert.deepEqual(pendingEraseOrders(reader({ eraseOrders: [{ order: 'o1', id: 'sas' }, { id: 'x' }, 'junk', null] })), [{ order: 'o1', id: 'sas' }]);
  assert.deepEqual(pendingEraseOrders(reader({})), []);
});
