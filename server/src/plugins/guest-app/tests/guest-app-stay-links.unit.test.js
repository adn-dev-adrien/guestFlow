// specs/guest-app.md rules 1, 9, 9bis, 11quater — the stay link on the operator's side: created the first time
// the SAS step, an e-mail or the fiche needs it, shown again, regenerated (the old link and its sessions die at
// once); the SAS payload's switch and the plugin's own `{{stayAppUrl}}` e-mail variable with its gate-link fallback.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addStay, enable, freshDb, openStay, startApi,
} = require('./guestAppFixtures');
const { buildContext } = require('../../../utils/emailContextBuilder');
const { validUntilLabel } = require('../controllers/stayLinksController');
const { TOKENS, stayAppEmailContext } = require('../emailContext');

const HOST = 'sejour.example.test';
const LINK = (id) => `/api/guest-app/reservations/${id}/stay-link`;
const TOKEN_URL = new RegExp(`^https://${HOST.replace(/\./g, '\\.')}/s/([A-Za-z0-9_-]{22})$`);

async function withApi(fn, options = { guestHost: HOST }) {
  const db = freshDb();
  const ctx = await startApi(db, options);
  try {
    await fn({ db, ...ctx });
  } finally {
    await ctx.close();
  }
}

const tokenOf = (url) => url.match(TOKEN_URL)[1];

test('rule 1: the link is created on first need, then the same one is shown again', () => withApi(async ({ db, api, call }) => {
  enable(api, db);
  const id = addStay(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_stay_links').get().n, 0, 'nothing before it is needed');
  const first = await call('GET', LINK(id));
  assert.equal(first.status, 200);
  assert.match(first.body.url, TOKEN_URL);
  assert.match(first.body.qrDataUri, /^data:image\/png;base64,/);
  assert.equal(first.body.validUntil, '2099-07-09T10:00:00.000Z');
  assert.equal(first.body.validUntilLabel, 'Le lien vaut jusqu’au jeu. 9 juil., 12 h.');
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal((await call('GET', LINK(id))).body.url, first.body.url);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_stay_links').get().n, 1);
  const opened = await call('POST', '/public/v1/guest/sessions', { stayToken: tokenOf(first.body.url) });
  assert.equal(opened.body.data.mode, 'stay', 'the URL shown is the one the guest opens');
}));

test('rule 1: « Régénérer le lien » — a new link; the old one and every session opened from it die at once', () => withApi(async ({ db, api, call, cookies }) => {
  enable(api, db);
  const id = addStay(db);
  const old = (await call('GET', LINK(id))).body.url;
  await call('POST', '/public/v1/guest/sessions', { stayToken: tokenOf(old) });
  const session = cookies.value;
  assert.equal((await call('GET', '/public/v1/guest/me', null, { cookie: session })).status, 200);
  const fresh = await call('POST', `${LINK(id)}/regenerate`);
  assert.equal(fresh.status, 200);
  assert.notEqual(fresh.body.url, old);
  assert.equal((await call('GET', LINK(id))).body.url, fresh.body.url, 'the new one is the one shown from now on');
  assert.equal((await call('GET', '/public/v1/guest/me', null, { cookie: session })).status, 401);
  const stale = await call('POST', '/public/v1/guest/sessions', { stayToken: tokenOf(old) }, { cookie: null });
  assert.equal(stale.status, 404);
  assert.equal(stale.body.error.code, 'CODE_NOT_FOUND');
  const rows = db.prepare('SELECT revokedAt FROM guest_stay_links ORDER BY id').all();
  assert.equal(rows.length, 2);
  assert.ok(rows[0].revokedAt);
  assert.equal(rows[1].revokedAt, null);
}));

test('rule 1: a link whose token no longer decrypts is replaced, not shown broken', () => withApi(async ({ db, api, call }) => {
  enable(api, db);
  const id = addStay(db);
  const old = (await call('GET', LINK(id))).body.url;
  db.prepare("UPDATE guest_stay_links SET tokenEncrypted = 'enc:v1:AAAA:BBBB:CCCC'").run();
  const shown = await call('GET', LINK(id));
  assert.equal(shown.status, 200);
  assert.notEqual(shown.body.url, old);
}));

test('rules 9, 11quater: a cancelled stay or a lodging off has no link, and its link sessions die', () => withApi(async ({ db, api, call, cookies }) => {
  enable(api, db);
  const id = addStay(db);
  await openStay(call, db, id);
  const session = cookies.value;
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(id);
  assert.equal((await call('GET', '/public/v1/guest/me', null, { cookie: session })).status, 401);
  const cancelled = await call('GET', LINK(id));
  assert.equal(cancelled.status, 409);
  assert.match(cancelled.body.error, /réservation en cours/);
  db.prepare("UPDATE reservations SET kind = 'reservation' WHERE id = ?").run(id);
  await call('PUT', '/api/guest-app/lodgings/1', { enabled: false });
  const off = await call('GET', LINK(id));
  assert.equal(off.status, 409);
  assert.match(off.body.error, /pas dans l’application/);
  assert.equal((await call('POST', `${LINK(id)}/regenerate`)).status, 409);
}));

test('rule 9bis: an unknown reservation is 404, a malformed id 400', () => withApi(async ({ db, api, call }) => {
  enable(api, db);
  assert.equal((await call('GET', LINK(99))).status, 404);
  for (const bad of ['abc', '0', '-1', '1.5']) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await call('GET', LINK(bad))).status, 400, bad);
  }
}));

test('rule 9bis: without the guest host the link cannot say where to go', () => withApi(async ({ db, api, call }) => {
  enable(api, db);
  const res = await call('GET', LINK(addStay(db)));
  assert.equal(res.status, 409);
  assert.match(res.body.error, /adresse de l’application/);
}, { guestHost: null }));

test('rule 9bis (a): the SAS shows « Mon séjour » only for a live stay of a lodging in the app, and reads without writing', () => withApi(async ({ db, api }) => {
  const id = addStay(db);
  assert.equal(api.stayLinkAvailable(id), false, 'lodging off');
  enable(api, db);
  assert.equal(api.stayLinkAvailable(id), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_stay_links').get().n, 0, 'the SAS read creates nothing');
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(id);
  assert.equal(api.stayLinkAvailable(id), false, 'cancelled');
  assert.equal(api.stayLinkAvailable(99), false, 'unknown');
}));

test('rule 9bis (b): the reminder e-mails carry the stay link, created on first need; none without an address', () => withApi(async ({ db, api, call }) => {
  enable(api, db);
  const id = addStay(db);
  const url = api.stayAppUrl(id);
  assert.match(url, TOKEN_URL);
  assert.equal((await call('GET', LINK(id))).body.url, url, 'the same link as the SAS and the fiche');
  db.prepare("UPDATE clients SET email = '' WHERE id = 1").run();
  assert.equal(api.stayAppUrl(id), '');
  db.prepare("UPDATE clients SET email = 'marie@example.test' WHERE id = 1").run();
  await call('PUT', '/api/guest-app/lodgings/1', { enabled: false });
  assert.equal(api.stayAppUrl(id), '', 'lodging off');
}));

test('rule 9bis (b): `{{stayAppUrl}}` is the plugin\'s own variable, falling back to the gate link while the app gives none', () => {
  const stayUrl = `https://${HOST}/s/abc`;
  const gateUrl = 'https://gate.example.test/k';
  const flags = (hasStayApp, shop = false, bath = false) => ({ hasStayApp, hasStayAppShop: shop, hasStayAppBath: bath });
  assert.deepEqual(stayAppEmailContext({ stayUrl, gateUrl }), { tokens: { stayAppUrl: stayUrl }, flags: flags(true) });
  assert.deepEqual(stayAppEmailContext({ stayUrl: '', gateUrl }), { tokens: { stayAppUrl: gateUrl }, flags: flags(false) }, 'lodging off or no address');
  assert.deepEqual(stayAppEmailContext({ stayUrl: '', gateUrl: null }), { tokens: { stayAppUrl: '' }, flags: flags(false) }, 'no gate key either');
  // Rules 70, 89 — the shop and the bath clause only ever follow the app's own link, and the bath only follows the shop.
  assert.deepEqual(stayAppEmailContext({ stayUrl, gateUrl, shop: true, bath: true }).flags, flags(true, true, true));
  assert.deepEqual(stayAppEmailContext({ stayUrl, gateUrl, shop: true, bath: false }).flags, flags(true, true, false));
  assert.deepEqual(stayAppEmailContext({ stayUrl, gateUrl, shop: false, bath: true }).flags, flags(true, false, false), 'no shop, no bath sentence');
  assert.deepEqual(stayAppEmailContext({ stayUrl: '', gateUrl, shop: true, bath: true }).flags, flags(false), 'never under the gate link');
  assert.deepEqual(TOKENS.map((t) => [t.name, t.label, [...t.in]]), [['stayAppUrl', 'Lien Mon séjour', ['j7', 'j2']]]);
  assert.equal(buildContext({ reservation: { id: 1 }, pluginContext: { tokens: {}, flags: {} } }).vars.stayAppUrl, undefined,
    'not a core variable: absent while the plugin is not there');
});

test('rule 2: the validity line reads the end of the stay window in Europe/Paris', () => {
  assert.equal(validUntilLabel(new Date('2099-11-09T11:00:00Z')), 'Le lien vaut jusqu’au lun. 9 nov., 12 h.');
  assert.equal(validUntilLabel(new Date('2099-07-09T10:30:00Z')), 'Le lien vaut jusqu’au jeu. 9 juil., 12 h 30.');
});

test('rule 9bis (a): the reception, who runs the SAS, reads and regenerates the link; the accountant does neither', () => {
  const enforceRoleAccess = require('../../../middleware/enforceRoleAccess');
  require('../../loader').registerAll({ db: null, isInstalled: () => false });
  require('../../sdk/registry').configure({ isActive: () => true, allows: () => true });
  const passes = (roles, method, path) => {
    const res = { status() { return this; }, json() { return this; } };
    let passed = false;
    enforceRoleAccess({ user: { roles }, method, path }, res, () => { passed = true; });
    return passed;
  };
  assert.equal(passes(['reception'], 'GET', '/guest-app/reservations/42/stay-link'), true);
  assert.equal(passes(['reception'], 'POST', '/guest-app/reservations/42/stay-link/regenerate'), true);
  assert.equal(passes(['reception'], 'PUT', '/guest-app/reservations/42/stay-link'), false);
  assert.equal(passes(['reception'], 'GET', '/guest-app/lodgings/1'), false, 'nothing else of the plugin');
  assert.equal(passes(['accountant'], 'GET', '/guest-app/reservations/42/stay-link'), false);
});
