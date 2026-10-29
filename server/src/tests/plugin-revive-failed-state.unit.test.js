// specs/plugin-dependencies.md rule 24 (audit r3, N-R3-3) — a dependant revived live whose migration throws
// reads « Erreur » (« Échec du démarrage. »), not « Incompatible » with no message.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./pluginPackagesFixture');

const R = { id: 'website-booking' };
const D = {
  id: 'google-vacation-rentals',
  requires: [{ id: 'website-booking', range: '^1.0.0' }],
  serverCode: "module.exports = { id: 'google-vacation-rentals', register(ctx) { ctx.migrations([{ name: 'gvr-1', up: () => { throw new Error('disk full'); } }]); } };",
};

test('rule 24: the revive migration failure clears the incompatible state and the card shows the failure', async () => {
  const s = h.realSetup([R, D]);
  const pkg = s.state.store.bundled()['google-vacation-rentals'];
  s.model.install('google-vacation-rentals', { version: '1.0.0', source: 'bundled', manifest: pkg.manifest, sha256: pkg.sha256 });
  s.state.incompatible['google-vacation-rentals'] = { code: 'REQUIREMENT_MISSING', message: 'Nécessite website-booking.' };
  await h.call(s.ctrl.install, { params: { id: 'website-booking' } });
  assert.equal(s.state.incompatible['google-vacation-rentals'], undefined);
  const list = await h.call(s.ctrl.list, { params: {}, query: {} });
  const card = list.body.find((p) => p.id === 'google-vacation-rentals');
  assert.equal(card.state, 'failed');
  assert.equal(card.incompatible, null);
});
