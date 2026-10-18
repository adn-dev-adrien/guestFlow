// specs/hosting-h1-fleet-runtime.md rule 25 — a new hosted instance starts with what the console
// knows: its public address and the console's plugin registry (with the key its index is signed
// with) in its environment, rewritten at every sync so a rename moves the address; and its
// establishment seeded from the customer's record at the creation step.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, NEW_CUSTOMER } = require('./helpers');
const { readEnv, buildEnv } = require('../utils/instanceEnv');

test('rule 25 — the env file names the instance’s address, the registry and its key', async () => {
  const h = makeContext();
  try {
    const v = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    const env = readEnv(h.ctx.instances.envFileOf('aulnes'));
    assert.equal(env.GUESTFLOW_PUBLIC_URL, 'https://aulnes.guestflow.test');
    assert.equal(env.GUESTFLOW_REGISTRY_URL, 'https://console.guestflow.test/registry/v1');
    const spki = h.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    assert.equal(env.GUESTFLOW_REGISTRY_PUBLIC_KEY, spki);
    assert.equal(env.GUESTFLOW_LICENCE_PUBLIC_KEY, spki);

    // The rename rewrites it: no « URL publique » left on the checklist.
    const preview = h.ctx.controllers.customers.renamePreview(v.id, { slug: 'aulnes-neuf' });
    assert.ok(!preview.checklist.some((i) => i.key === 'publicUrl'));
    await h.ctx.controllers.customers.rename(v.id, { slug: 'aulnes-neuf', checked: preview.checklist.map((i) => i.key) }, 'op');
    assert.equal(readEnv(h.ctx.instances.envFileOf('aulnes-neuf')).GUESTFLOW_PUBLIC_URL, 'https://aulnes-neuf.guestflow.test');
  } finally {
    h.cleanup();
  }
});

test('rule 25 — without a licence key no registry is announced (its index could not be checked)', () => {
  const env = buildEnv({ inst: { slug: 'aulnes', dir: '/srv/i/aulnes', port: 4400, version: '3.10.0' }, releasesDir: '/srv/r', secrets: {}, licencePublicKey: null, publicUrl: 'https://aulnes.guestflow.test', registryUrl: 'https://console.guestflow.test/registry/v1' });
  assert.equal(env.GUESTFLOW_REGISTRY_URL, undefined);
  assert.equal(env.GUESTFLOW_REGISTRY_PUBLIC_KEY, undefined);
  assert.equal(env.GUESTFLOW_PUBLIC_URL, 'https://aulnes.guestflow.test');
});

test('rule 25 — the creation step seeds the establishment; a later re-send does not', async () => {
  const h = makeContext();
  try {
    const v = await h.ctx.controllers.customers.create({ ...NEW_CUSTOMER, vatNumber: 'FR 12 345678901' }, 'op');
    const [first] = h.firstAdminCalls;
    assert.equal(first.company, 'Gîte des Aulnes');
    assert.deepEqual(first.establishment, {
      name: 'Gîte des Aulnes', email: 'claire@aulnes.fr', address: '4 route des Aulnes, 07140 Les Vans', tva: 'FR12345678901',
    });
    h.firstAdminCalls.length = 0;
    await h.ctx.controllers.customers.resendInvitation(v.id, 'op').catch(() => null);
    assert.equal(h.firstAdminCalls[0].establishment, null);
  } finally {
    h.cleanup();
  }
});
