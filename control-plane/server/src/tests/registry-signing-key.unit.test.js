// specs/plugins-phase-4-registry.md rule 42 (audit 2026-10-28): the registry index can be signed with a key
// of its own (CP_REGISTRY_PRIVATE_KEY); the instances are told that key's public half. Unset, the licence key
// signs it, as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const { makeContext, NEW_CUSTOMER } = require('./helpers');
const { readEnv } = require('../utils/instanceEnv');

const spki = (key) => key.export({ format: 'der', type: 'spki' }).toString('base64');

function verifies(h, publicKey) {
  const { index, signature } = h.ctx.registry.indexFiles();
  return crypto.verify(null, fs.readFileSync(index), publicKey, Buffer.from(fs.readFileSync(signature, 'utf8').trim(), 'base64'));
}

test('rule 42: with CP_REGISTRY_PRIVATE_KEY the index is signed by it and instances trust its public key only', async () => {
  const registry = crypto.generateKeyPairSync('ed25519');
  const h = makeContext({ registryPrivateKey: registry.privateKey });
  try {
    assert.equal(verifies(h, registry.publicKey), true);
    assert.equal(verifies(h, h.publicKey), false, 'the licence key no longer signs the index');
    await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    const env = readEnv(h.ctx.instances.envFileOf('aulnes'));
    assert.equal(env.GUESTFLOW_REGISTRY_PUBLIC_KEY, spki(registry.publicKey));
    assert.equal(env.GUESTFLOW_LICENCE_PUBLIC_KEY, spki(h.publicKey));
  } finally {
    h.cleanup();
  }
});

test('rule 42: without it the licence key signs the index and is the registry key (fallback)', async () => {
  const h = makeContext();
  try {
    assert.equal(verifies(h, h.publicKey), true);
    await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    assert.equal(readEnv(h.ctx.instances.envFileOf('aulnes')).GUESTFLOW_REGISTRY_PUBLIC_KEY, spki(h.publicKey));
  } finally {
    h.cleanup();
  }
});
