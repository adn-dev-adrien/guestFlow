// specs/guest-app.md rules 11bis, 11ter, 11quater — the per-lodging configuration, through the real routes.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { addStay, enable, freshDb, startApi } = require('./guestAppFixtures');
const { requireModule } = require('../middleware/guestSession');
const { MODULE_KEYS, defaultModules, readModules, shownModules, tilesOf } = require('../modules');

function withApi(name, fn, options) {
  test(name, async () => {
    const db = freshDb();
    const ctx = await startApi(db, options);
    try {
      await fn({ db, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

const FACTS = { gateAccess: true, wifiConfigured: true, soldItems: 1, soldHourlyResources: 1, soliomapUrl: 'https://x.test', contactCount: 1 };
const keysOf = (shown) => shown.map((m) => m.key);
const allOn = () => defaultModules().map((m) => ({ ...m, on: true }));

test('rule 10: the default tiles are the six of the spec, in order', () => {
  assert.deepEqual(keysOf(tilesOf(shownModules(null, FACTS, 'stay'))), ['gate', 'wifi', 'shop', 'bath', 'soliomap', 'booklet']);
});

test('rule 51: the orders tab is a module, not one of the tiles', () => {
  const shown = shownModules(null, FACTS, 'stay');
  assert.ok(keysOf(shown).includes('orders'));
  assert.equal(keysOf(tilesOf(shown)).includes('orders'), false);
});

test('rule 11bis: a module off is not shown, the order is the configured one', () => {
  const modules = allOn().reverse().map((m, order) => ({ ...m, order }));
  modules.find((m) => m.key === 'shop').on = false;
  assert.deepEqual(keysOf(shownModules(modules, FACTS, 'stay')), ['contacts', 'orders', 'booklet', 'soliomap', 'wifi', 'gate'], 'the bath goes with the shop');
});

test('rule 11bis: on but its prerequisite fails → not shown', () => {
  const cases = [['gate', { gateAccess: false }], ['wifi', { wifiConfigured: false }], ['shop', { soldItems: 0 }], ['bath', { soldHourlyResources: 0 }], ['soliomap', { soliomapUrl: '' }], ['contacts', { contactCount: 0 }]];
  cases.forEach(([key, lack]) => {
    assert.equal(keysOf(shownModules(allOn(), { ...FACTS, ...lack }, 'stay')).includes(key), false, key);
  });
});

test('rules 11bis, 13: the gate needs gate-access live and a stay session — the key itself need not exist yet', () => {
  assert.equal(keysOf(shownModules(allOn(), { ...FACTS, gateAccess: true }, 'stay')).includes('gate'), true);
  assert.equal(keysOf(shownModules(allOn(), { ...FACTS, gateAccess: false }, 'stay')).includes('gate'), false);
  assert.equal(keysOf(shownModules(allOn(), { ...FACTS, gateAccess: true }, 'preArrival')).includes('gate'), false, 'outside the gate window');
});

test('rule 11bis: the bath is a shortcut into the shop — shop off or empty hides it too', () => {
  const shopOff = allOn().map((m) => (m.key === 'shop' ? { ...m, on: false } : m));
  assert.equal(keysOf(shownModules(shopOff, FACTS, 'stay')).includes('bath'), false);
  assert.equal(keysOf(shownModules(allOn(), { ...FACTS, soldItems: 0 }, 'stay')).includes('bath'), false);
  assert.equal(keysOf(shownModules(allOn(), FACTS, 'stay')).includes('bath'), true);
});

test('rules 5, 6: a visitor has no gate, shop, bath or orders; pre-arrival keeps the catalogue', () => {
  assert.deepEqual(keysOf(shownModules(allOn(), FACTS, 'visitor')), ['wifi', 'soliomap', 'booklet', 'contacts']);
  assert.deepEqual(keysOf(shownModules(allOn(), FACTS, 'preArrival')), ['wifi', 'shop', 'soliomap', 'booklet', 'contacts']);
});

test('rule 11bis: a stored list survives a module it does not know, and drops one that is gone', () => {
  const read = readModules([{ key: 'booklet', on: true, order: 0 }, { key: 'retired', on: true, order: 1 }]);
  assert.equal(read[0].key, 'booklet');
  assert.deepEqual([...read.map((m) => m.key)].sort(), [...MODULE_KEYS].sort());
  assert.deepEqual(read.map((m) => m.order), read.map((_, i) => i));
});

test('rule 11bis: a module off answers 404 MODULE_OFF, an on one passes', async () => {
  const app = express();
  app.get('/off', requireModule('shop', () => ['wifi']), (req, res) => res.json({ reached: true }));
  app.get('/on', requireModule('wifi', () => ['wifi']), (req, res) => res.json({ reached: true }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const off = await fetch(`${base}/off`);
    assert.equal(off.status, 404);
    assert.equal((await off.json()).error.code, 'MODULE_OFF');
    assert.equal((await fetch(`${base}/on`)).status, 200);
  } finally {
    await new Promise((resolve) => { server.close(resolve); });
  }
});

withApi('rule 11bis: /me and /lodging follow the lodging’s switches', async ({ db, api, call }) => {
  addStay(db);
  const modules = defaultModules().map((m) => (m.key === 'soliomap' ? { ...m, on: false } : m));
  const code = enable(api, db, 1, { modules });
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.body.data.tiles.some((t) => t.key === 'soliomap'), false);
  assert.equal(me.body.data.tiles.some((t) => t.key === 'booklet'), true);
  const lodging = await call('GET', '/public/v1/guest/lodging');
  assert.equal(lodging.body.data.modules.some((m) => m.key === 'soliomap'), false);
});

withApi('rule 11bis: the shop follows the items sold for this lodging, the other lodging keeps its own', async ({ db, api, call }) => {
  addStay(db);
  const code = enable(api, db, 1);
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  const tiles = async () => (await call('GET', '/public/v1/guest/me')).body.data.tiles.map((t) => t.key);
  assert.equal((await tiles()).includes('shop'), false);
  db.prepare("INSERT INTO options (id, title) VALUES (5, 'Cidre')").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (2, 5)').run();
  db.prepare("INSERT INTO guest_app_items (kind, itemId, sold) VALUES ('option', 5, 1)").run();
  assert.equal((await tiles()).includes('shop'), false);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 5)').run();
  assert.equal((await tiles()).includes('shop'), true);
  db.prepare("UPDATE options SET archivedAt = '2099-01-01' WHERE id = 5").run();
  assert.equal((await tiles()).includes('shop'), false);
});

withApi('rules 11bis, 13: a stay session gets the gate tile while gate-access is live, before any key exists', async ({ db, api, call }) => {
  const registry = require('../../sdk/registry');
  addStay(db);
  const code = enable(api, db, 1);
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  const tiles = async () => (await call('GET', '/public/v1/guest/me')).body.data.tiles.map((t) => t.key);
  try {
    registry.configure({ isActive: () => true, allows: () => true });
    registry.ensure('gate-access');
    assert.equal((await tiles()).includes('gate'), true);
    registry.discard('gate-access');
    assert.equal((await tiles()).includes('gate'), false);
  } finally {
    registry.reset();
  }
});

withApi('rule 11ter: wifi facts reach /lodging with a join QR; wifi off → no tile, no block', async ({ db, api, call }) => {
  addStay(db);
  const code = enable(api, db, 1, { wifi: { available: true, network: 'Granja;5G', password: 'sapin:42', note: 'Dans la pièce principale' } });
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  const on = (await call('GET', '/public/v1/guest/lodging')).body.data;
  assert.equal(on.wifi.network, 'Granja;5G');
  assert.equal(on.wifi.password, 'sapin:42');
  assert.equal(on.wifi.note, 'Dans la pièce principale');
  assert.match(on.wifi.joinQr, /^data:image\/png;base64,/);
  await call('PUT', '/api/guest-app/lodgings/1', { wifi: { available: false } });
  const off = (await call('GET', '/public/v1/guest/lodging')).body.data;
  assert.equal(off.wifi, undefined);
  assert.equal((await call('GET', '/public/v1/guest/me')).body.data.tiles.some((t) => t.key === 'wifi'), false);
});

withApi('rule 11ter: the wifi password is encrypted at rest and kept when a save omits it', async ({ db, call }) => {
  const saved = await call('PUT', '/api/guest-app/lodgings/1', { enabled: true, wifi: { available: true, network: 'Granja', password: 'sapin42' } });
  assert.equal(saved.status, 200);
  const stored = () => db.prepare('SELECT wifiPasswordEncrypted AS p FROM guest_app_lodgings WHERE propertyId = 1').get().p;
  assert.match(stored(), /^enc:v1:/);
  assert.equal(stored().includes('sapin42'), false);
  const kept = await call('PUT', '/api/guest-app/lodgings/1', { wifi: { available: true, network: 'Granja 2' } });
  assert.equal(kept.body.wifi.password, 'sapin42');
  assert.equal(kept.body.wifi.network, 'Granja 2');
  const cleared = await call('PUT', '/api/guest-app/lodgings/1', { wifi: { available: true, network: 'Granja 2', password: '' } });
  assert.equal(cleared.body.wifi.password, '');
  assert.equal(stored(), null);
});

withApi('rule 11ter: a password that no longer decrypts does not take the home down', async ({ db, api, call }) => {
  addStay(db);
  const code = enable(api, db, 1, { wifi: { available: true, network: 'Granja', password: 'x' } });
  db.prepare("UPDATE guest_app_lodgings SET wifiPasswordEncrypted = 'enc:v1:AAAA:BBBB:CCCC'").run();
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  assert.equal((await call('GET', '/public/v1/guest/me')).status, 200);
});

withApi('rule 11ter: display name and contacts are per lodging; contacts follow their module', async ({ db, api, call }) => {
  const contacts = [{ name: 'Adrien', role: 'Accueil', phone: '0600000000' }];
  const code = enable(api, db, 1, { displayName: 'Granja', contacts });
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  const hidden = (await call('GET', '/public/v1/guest/lodging')).body.data;
  assert.equal(hidden.name, 'Granja');
  assert.deepEqual(hidden.contacts, []);
  const modules = defaultModules().map((m) => (m.key === 'contacts' ? { ...m, on: true } : m));
  await call('PUT', '/api/guest-app/lodgings/1', { modules });
  assert.deepEqual((await call('GET', '/public/v1/guest/lodging')).body.data.contacts, contacts);
});

withApi('rule 5: /lodging answers the printed code in visitor mode, and refuses anything else', async ({ db, api, call }) => {
  const code = enable(api, db, 1);
  const visitor = await call('GET', `/public/v1/guest/lodging?lodgingCode=${code}`);
  assert.equal(visitor.status, 200);
  assert.equal(visitor.body.data.name, 'La Granja');
  assert.equal((await call('GET', '/public/v1/guest/lodging?lodgingCode=guess')).status, 401);
  assert.equal((await call('GET', '/public/v1/guest/lodging')).status, 401);
});

withApi('rule 11quater: a new property starts off, without a code; enabling issues one and it survives a disable', async ({ db, call }) => {
  const initial = await call('GET', '/api/guest-app/lodgings/2');
  assert.equal(initial.status, 200);
  assert.equal(initial.body.enabled, false);
  assert.equal(initial.body.hasLodgingCode, false);
  const off = await call('PUT', '/api/guest-app/lodgings/2', { displayName: 'Estiva' });
  assert.equal(off.body.hasLodgingCode, false);
  const on = await call('PUT', '/api/guest-app/lodgings/2', { enabled: true });
  assert.equal(on.body.hasLodgingCode, true);
  const code = () => db.prepare('SELECT lodgingCode FROM guest_app_lodgings WHERE propertyId = 2').get().lodgingCode;
  const first = code();
  await call('PUT', '/api/guest-app/lodgings/2', { enabled: false });
  await call('PUT', '/api/guest-app/lodgings/2', { enabled: true });
  assert.equal(code(), first);
  assert.equal(JSON.stringify(on.body).includes(first), false, 'the admin read does not hand out the code');
});

withApi('rule 11quater: a disabled lodging refuses its lookup and kills its sessions', async ({ db, api, call }) => {
  addStay(db);
  const code = enable(api, db, 1);
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  assert.equal((await call('GET', '/public/v1/guest/me')).status, 200);
  const cookie = (await call('POST', '/public/v1/guest/sessions', { lodgingCode: code })).setCookie.split(';')[0];
  await call('PUT', '/api/guest-app/lodgings/1', { enabled: false });
  assert.equal((await call('GET', '/public/v1/guest/me', null, { cookie })).status, 401);
  const lookup = await call('POST', '/public/v1/guest/sessions/lookup', { lastName: 'Le Goff-Durand', reservationNumber: 'R-99-001' });
  assert.equal(lookup.status, 404);
  assert.equal(lookup.body.error.code, 'STAY_NOT_FOUND');
});

test('rule 11quater: the lodging configuration is the admin’s, a restricted role is refused', () => {
  const enforceRoleAccess = require('../../../middleware/enforceRoleAccess');
  ['reception', 'accountant'].forEach((role) => {
    const res = { code: null, status(code) { this.code = code; return this; }, json() { return this; } };
    let passed = false;
    enforceRoleAccess({ user: { roles: [role] }, method: 'GET', path: '/guest-app/lodgings/1' }, res, () => { passed = true; });
    assert.equal(passed, false, role);
    assert.equal(res.code, 403, role);
  });
});

const BAD_BODIES = [
  ['enabled not a boolean', { enabled: 'yes' }],
  ['unknown module', { modules: [...defaultModules().slice(1), { key: 'casino', on: true, order: 7 }] }],
  ['module twice', { modules: [...defaultModules().slice(1), { key: 'wifi', on: true, order: 7 }] }],
  ['module missing', { modules: defaultModules().slice(1) }],
  ['order not a permutation', { modules: defaultModules().map((m) => ({ ...m, order: 1 })) }],
  ['on not a boolean', { modules: defaultModules().map((m) => ({ ...m, on: 1 })) }],
  ['network too long', { wifi: { available: true, network: 'x'.repeat(65) } }],
  ['password too long', { wifi: { available: true, network: 'x', password: 'x'.repeat(129) } }],
  ['note too long', { wifi: { available: true, network: 'x', note: 'x'.repeat(201) } }],
  ['wifi on without a network', { wifi: { available: true, network: ' ' } }],
  ['wifi without its switch', { wifi: { network: 'x' } }],
  ['too many contacts', { contacts: Array.from({ length: 11 }, () => ({ name: 'x' })) }],
  ['contact without a name', { contacts: [{ phone: '06' }] }],
  ['hero not an id', { heroMediaId: 'x' }],
  ['display name too long', { displayName: 'x'.repeat(81) }],
];

withApi('rule 11bis: the boundary refuses a bad body and stores nothing', async ({ db, call }) => {
  for (const [label, body] of BAD_BODIES) {
    // eslint-disable-next-line no-await-in-loop
    const res = await call('PUT', '/api/guest-app/lodgings/1', body);
    assert.equal(res.status, 400, label);
    assert.equal(typeof res.body.error, 'string', label);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_app_lodgings').get().n, 0);
});

withApi('rule 11bis: an unknown property answers 404, a bad id 400', async ({ call }) => {
  assert.equal((await call('GET', '/api/guest-app/lodgings/99')).status, 404);
  assert.equal((await call('PUT', '/api/guest-app/lodgings/99', { enabled: true })).status, 404);
  assert.equal((await call('GET', '/api/guest-app/lodgings/abc')).status, 400);
});
