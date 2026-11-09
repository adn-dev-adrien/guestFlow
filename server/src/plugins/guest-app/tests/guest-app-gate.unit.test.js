// specs/guest-app.md rules 12, 13, 14 — the « Portail » tile is a door to the gate app that exists: the stay's key link
// as gate-access holds it (the e-mails' {{gateAccessUrl}}), for a stay session only; « Accès en préparation » while
// Sowel has not read the key, with the arrival-day card that promises no time; gate-access off → no tile, 404.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addStay, enable, freshDb, latestStayToken, paris, startApi,
} = require('./guestAppFixtures');
const registry = require('../../sdk/registry');
const { keyUrlOf } = require('../gate');
const { defaultModules } = require('../modules');

const KEY_URL = 'https://portail.example.test/k/abc';

function withGate(name, fn, { live = true, url = KEY_URL } = {}) {
  test(name, async () => {
    registry.reset();
    registry.configure({ isActive: () => true, allows: () => true });
    if (live) registry.ensure('gate-access');
    const db = freshDb();
    const keys = { url };
    const ctx = await startApi(db, { readGateUrl: () => keys.url });
    try {
      await fn({ db, keys, ...ctx });
    } finally {
      await ctx.close();
      registry.reset();
    }
  });
}

const openLink = async ({ call, api, db }) => {
  enable(api, db, 1);
  addStay(db);
  return call('POST', '/public/v1/guest/sessions', { stayToken: latestStayToken(db) });
};
const gateTile = async (call) => (await call('GET', '/public/v1/guest/me')).body.data.tiles.find((t) => t.key === 'gate');

withGate('rules 12-13: a stay session with its key reads `active` and the key URL, on /gate and on the tile', async (ctx) => {
  await openLink(ctx);
  const gate = await ctx.call('GET', '/public/v1/guest/gate');
  assert.equal(gate.status, 200);
  assert.deepEqual(gate.body.data, { state: 'active', url: KEY_URL });
  const tile = await gateTile(ctx.call);
  assert.deepEqual([tile.state, tile.url, tile.stateLabel], ['active', KEY_URL, undefined]);
});

withGate('rule 13: before Sowel has read the key — « Accès en préparation », no URL; the arrival-day card promises no time', async (ctx) => {
  ctx.keys.url = null;
  ctx.clock.now = paris('2099-07-06', '15:00');
  await openLink(ctx);
  assert.deepEqual((await ctx.call('GET', '/public/v1/guest/gate')).body.data, { state: 'preparing' });
  const me = (await ctx.call('GET', '/public/v1/guest/me')).body.data;
  const tile = me.tiles.find((t) => t.key === 'gate');
  assert.deepEqual([tile.state, tile.url, tile.stateLabel], ['preparing', undefined, 'Accès en préparation']);
  assert.deepEqual([me.highlight.key, me.highlight.text, me.highlight.detail], [
    'gatePreparing', 'Votre accès au portail se prépare', 'La tuile Portail s’activera dès que votre accès sera prêt.',
  ]);
  ctx.keys.url = KEY_URL;
  assert.equal((await ctx.call('GET', '/public/v1/guest/me')).body.data.highlight.text, 'Le portail est actif');
});

withGate('rule 13: outside the window there is no URL — a pre-arrival or a visitor session reads `outside`', async (ctx) => {
  ctx.clock.now = paris('2099-07-02', '12:00');
  await openLink(ctx);
  assert.deepEqual((await ctx.call('GET', '/public/v1/guest/gate')).body.data, { state: 'outside' });
  assert.equal(await gateTile(ctx.call), undefined, 'no tile before the window');
  const code = ctx.db.prepare('SELECT lodgingCode FROM guest_app_lodgings WHERE propertyId = 1').get().lodgingCode;
  await ctx.call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  assert.deepEqual((await ctx.call('GET', '/public/v1/guest/gate')).body.data, { state: 'outside' });
});

withGate('rule 11bis: the gate module off for the lodging answers MODULE_OFF', async (ctx) => {
  await openLink(ctx);
  await ctx.call('PUT', '/api/guest-app/lodgings/1', { modules: defaultModules().map((m) => (m.key === 'gate' ? { ...m, on: false } : m)) });
  const res = await ctx.call('GET', '/public/v1/guest/gate');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'MODULE_OFF');
});

withGate('rule 14: gate-access off — no tile, /gate 404 PLUGIN_INACTIVE', async (ctx) => {
  await openLink(ctx);
  const res = await ctx.call('GET', '/public/v1/guest/gate');
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'PLUGIN_INACTIVE', plugin: 'gate-access' });
  assert.equal(await gateTile(ctx.call), undefined);
}, { live: false });

test('rule 12: the URL is the e-mails\' {{gateAccessUrl}}, read from what gate-access declares — never while it is off', () => {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  const record = registry.ensure('gate-access');
  record.emailProviders.push({ build: (id) => ({ tokens: { gateAccessCode: '1234', gateAccessUrl: id === 7 ? KEY_URL : '' } }) });
  assert.equal(keyUrlOf(7), KEY_URL);
  assert.equal(keyUrlOf(8), null);
  registry.configure({ isActive: () => false });
  assert.equal(keyUrlOf(7), null);
  registry.reset();
});
