// specs/guest-app.md rules 1-6, 8, 9 and 33 — the stay link, the lodging poster and the fallback lookup, through the
// plugin's real routes, on an in-memory database and an injected clock (far-future dates, nothing compared with today).
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addStay, enable, freshDb, openStay, paris, startApi, stayToken,
} = require('./guestAppFixtures');

const { createGuestLimiters } = require('../rateLimiters');

async function setup(options) {
  const db = freshDb();
  const ctx = await startApi(db, options);
  return { db, ...ctx, code: enable(ctx.api, db) };
}

function withApi(name, fn, options) {
  test(name, async () => {
    const ctx = await setup(options);
    try {
      await fn(ctx);
    } finally {
      await ctx.close();
    }
  });
}

const SESSIONS = '/public/v1/guest/sessions';
const countSessions = (db) => db.prepare('SELECT COUNT(*) AS n FROM guest_sessions').get().n;

withApi('rule 1: a guessed stay token, a revoked one and a guessed lodging code read the same 404 (no oracle)', async ({ call, db }) => {
  const id = addStay(db);
  const old = stayToken(db, id);
  require('../models/stayLinksModel')(db).regenerate(id, new Date());
  const answers = [
    await call('POST', SESSIONS, { stayToken: 'guess' }),
    await call('POST', SESSIONS, { stayToken: old }),
    await call('POST', SESSIONS, { lodgingCode: 'guess' }),
  ];
  answers.forEach((a) => {
    assert.equal(a.status, 404);
    assert.deepEqual(a.body, { error: { code: 'CODE_NOT_FOUND', message: 'Ce code n’est pas reconnu.' } });
    assert.equal(a.setCookie, null);
  });
});

withApi('rule 1: the stay token holds 128 random bits, stored encrypted with its SHA-256, never in clear', async ({ db }) => {
  const token = stayToken(db, addStay(db));
  assert.match(token, /^[A-Za-z0-9_-]{22}$/);
  const row = db.prepare('SELECT * FROM guest_stay_links').get();
  assert.match(row.tokenEncrypted, /^enc:v1:/);
  assert.equal(row.tokenHash, require('../models/stayLinksModel').hashToken(token));
  assert.equal(JSON.stringify(row).includes(token), false);
});

withApi('rule 1: one live link per stay — asked again, the same link comes back', async ({ db }) => {
  const id = addStay(db);
  assert.equal(stayToken(db, id), stayToken(db, id));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_stay_links').get().n, 1);
});

withApi('rule 2: inside the window the link opens the stay of its own reservation, whatever the lodging hosts', async ({ call, db }) => {
  addStay(db, { reservationNumber: 'R-99-000', startDate: '2099-07-01', endDate: '2099-07-04' });
  const id = addStay(db);
  addStay(db, { propertyId: 2, reservationNumber: 'R-99-002' });
  const res = await openStay(call, db, id);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, { mode: 'stay', lodging: { id: 1, name: 'La Granja', slug: 'la-granja' } });
  assert.equal(db.prepare('SELECT reservationId FROM guest_sessions').get().reservationId, id);
});

withApi('rule 2: from J-7 00:00 the link opens the pre-arrival, without the gate, and says when the window opens', async ({ call, db, clock }) => {
  const id = addStay(db);
  clock.now = paris('2099-06-29', '00:00');
  const res = await openStay(call, db, id);
  assert.equal(res.body.data.mode, 'preArrival');
  assert.equal(res.body.data.opensAt, '2099-07-06T11:00:00.000Z');
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.body.data.mode, 'preArrival');
  assert.equal(me.body.data.guest.firstName, 'Marie');
  assert.equal(me.body.data.tiles.some((t) => t.key === 'gate'), false);
});

withApi('rule 2: before J-7 the link opens the lodging’s visitor mode, and that session ends at J-7', async ({ call, db, clock }) => {
  const id = addStay(db);
  clock.now = paris('2099-06-28', '12:00');
  const res = await openStay(call, db, id);
  assert.deepEqual(res.body.data, { mode: 'visitor', lodging: { id: 1, name: 'La Granja', slug: 'la-granja' } });
  const row = db.prepare('SELECT * FROM guest_sessions').get();
  assert.equal(row.reservationId, null);
  assert.equal(row.expiresAt, '2099-06-28T22:00:00.000Z');
  assert.equal((await call('GET', '/public/v1/guest/me')).body.data.guest, undefined);
});

withApi('rule 2: after the window the link opens the visitor mode, marked as ended', async ({ call, db, clock }) => {
  const id = addStay(db);
  clock.now = paris('2099-07-09', '12:00');
  const res = await openStay(call, db, id);
  assert.equal(res.body.data.mode, 'visitor');
  assert.equal(res.body.data.ended, true);
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.body.data.mode, 'visitor');
  assert.equal(me.body.data.stay, undefined);
});

withApi('rules 2, 33: no name is ever asked — the name confirmation is gone, /me carries no name state', async ({ call, db, base }) => {
  await openStay(call, db, addStay(db));
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.status, 200);
  assert.equal('nameConfirmed' in me.body.data, false);
  assert.equal((await fetch(`${base}/public/v1/guest/me/confirm-name`, { method: 'POST' })).status, 404, 'no such route');
  const columns = db.prepare('PRAGMA table_info(guest_sessions)').all().map((c) => c.name);
  ['nameConfirmedAt', 'nameFailures', 'nameLockedUntil'].forEach((c) => assert.equal(columns.includes(c), false, c));
});

withApi('rule 3: the lodging poster opens the visitor mode only, even in the middle of a stay', async ({ call, db, code }) => {
  addStay(db);
  const res = await call('POST', SESSIONS, { lodgingCode: code });
  assert.deepEqual(res.body.data, { mode: 'visitor', lodging: { id: 1, name: 'La Granja', slug: 'la-granja' } });
  const row = db.prepare('SELECT * FROM guest_sessions').get();
  assert.deepEqual([row.reservationId, row.origin, row.stayLinkId], [null, 'poster', null]);
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.body.data.mode, 'visitor');
  assert.equal(me.body.data.guest, undefined);
});

withApi('rule 3: a poster scanned on an arrival day learns nothing of the stay that starts', async ({ call, db, code, clock }) => {
  addStay(db, { startDate: '2099-07-07', endDate: '2099-07-09' });
  clock.now = paris('2099-07-07', '11:00');
  const created = await call('POST', SESSIONS, { lodgingCode: code });
  assert.equal(created.body.data.opensAt, undefined);
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.body.data.opensAt, undefined);
  assert.equal(me.body.data.openingLine, undefined);
});

withApi('rule 4: the cookie is HttpOnly, Secure, SameSite=Strict and expires with the window; only its hash is stored', async ({ call, db }) => {
  const id = addStay(db);
  const { setCookie } = await openStay(call, db, id);
  assert.match(setCookie, /^gf_guest=[A-Za-z0-9_-]{43};/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Expires=Thu, 09 Jul 2099 10:00:00 GMT/);
  const token = setCookie.split(';')[0].split('=')[1];
  const row = db.prepare('SELECT * FROM guest_sessions').get();
  assert.notEqual(row.tokenHash, token);
  assert.match(row.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(row).includes(token), false);
  assert.deepEqual([row.origin, row.stayLinkId], ['link', db.prepare('SELECT id FROM guest_stay_links').get().id]);
});

withApi('rule 4: the same device reopening the link during the same phase reuses its session', async ({ call, db }) => {
  const id = addStay(db);
  await openStay(call, db, id);
  await openStay(call, db, id);
  assert.equal(countSessions(db), 1);
});

withApi('rule 4: two devices have two sessions on the same stay', async ({ call, db, cookies }) => {
  const id = addStay(db);
  await openStay(call, db, id);
  cookies.value = null;
  await openStay(call, db, id);
  assert.equal(countSessions(db), 2);
});

withApi('rule 4: the pre-arrival session ends when the window opens; the link exchanged again opens the stay', async ({ call, db, clock }) => {
  const id = addStay(db);
  clock.now = paris('2099-07-06', '11:00');
  const pre = await openStay(call, db, id);
  assert.match(pre.setCookie, /Expires=Mon, 06 Jul 2099 11:00:00 GMT/);
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.body.data.openingLine, 'Votre séjour commence aujourd’hui à 16 h — le portail et la boutique s’ouvriront à 13 h.');
  clock.now = paris('2099-07-06', '13:00');
  assert.equal((await call('GET', '/public/v1/guest/me')).status, 401);
  assert.equal((await openStay(call, db, id)).body.data.mode, 'stay');
  assert.equal((await call('GET', '/public/v1/guest/me')).body.data.mode, 'stay');
});

withApi('rule 5: the visitor mode carries no personal data and no stay module', async ({ call, code }) => {
  await call('POST', SESSIONS, { lodgingCode: code });
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.data.welcome, 'Bienvenue à La Granja');
  assert.equal(me.body.data.stay, undefined);
  const keys = me.body.data.tiles.map((t) => t.key);
  assert.equal(keys.includes('gate'), false);
  assert.equal(keys.includes('shop'), false);
  assert.ok(keys.includes('booklet'));
  assert.ok(keys.includes('soliomap'));
});

const LOOKUP = { lastName: 'le goff durand', reservationNumber: 'R-99-001' };

withApi('rule 6: name + number from J-7 → pre-arrival, without the gate', async ({ call, db, clock }) => {
  addStay(db);
  clock.now = paris('2099-07-01', '12:00');
  const res = await call('POST', '/public/v1/guest/sessions/lookup', LOOKUP);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.mode, 'preArrival');
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.body.data.mode, 'preArrival');
  assert.equal(me.body.data.tiles.some((t) => t.key === 'gate'), false);
  assert.equal(db.prepare('SELECT origin FROM guest_sessions').get().origin, 'lookup');
});

withApi('rule 6: two stays sharing a reservation number — each is tried against the name', async ({ call, db, clock }) => {
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (2, 'Paul', 'Martin', 'paul@example.test')").run();
  addStay(db, { clientId: 2, propertyId: 2 });
  const marie = addStay(db);
  clock.now = paris('2099-07-07', '12:00');
  const res = await call('POST', '/public/v1/guest/sessions/lookup', LOOKUP);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(db.prepare("SELECT reservationId FROM guest_sessions WHERE origin = 'lookup'").get().reservationId, Number(marie));
});

withApi('rule 6: every failure is the one generic error', async ({ call, db, clock }) => {
  addStay(db);
  addStay(db, { reservationNumber: 'R-99-CXL', kind: 'cancelled', startDate: '2099-08-01', endDate: '2099-08-04' });
  clock.now = paris('2099-07-07', '12:00');
  const answers = [
    await call('POST', '/public/v1/guest/sessions/lookup', { lastName: 'Martin', reservationNumber: 'R-99-001' }),
    await call('POST', '/public/v1/guest/sessions/lookup', { lastName: 'Le Goff-Durand', reservationNumber: 'R-00-000' }),
    await call('POST', '/public/v1/guest/sessions/lookup', { lastName: 'Le Goff-Durand', reservationNumber: 'R-99-CXL' }),
    await call('POST', '/public/v1/guest/sessions/lookup', {}),
  ];
  answers.forEach((a) => {
    assert.equal(a.status, 404);
    assert.equal(a.body.error.code, 'STAY_NOT_FOUND');
    assert.equal(a.body.error.message, 'Nous n’avons pas trouvé ce séjour. Vérifiez le nom et le numéro.');
    assert.equal(a.setCookie, null);
  });
  clock.now = paris('2099-06-28', '12:00');
  assert.equal((await call('POST', '/public/v1/guest/sessions/lookup', LOOKUP)).status, 404);
  clock.now = paris('2099-07-09', '12:00');
  assert.equal((await call('POST', '/public/v1/guest/sessions/lookup', LOOKUP)).status, 404);
});

test('rule 6: the sixth lookup in 15 minutes is throttled', async () => {
  const ctx = await setup({ limiters: { lookup: createGuestLimiters().lookup } });
  try {
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      statuses.push((await ctx.call('POST', '/public/v1/guest/sessions/lookup', { lastName: 'x', reservationNumber: `n${i}` })).status);
    }
    assert.deepEqual(statuses, [404, 404, 404, 404, 404, 429]);
  } finally {
    await ctx.close();
  }
});

test('§4.3: the 31st link opened in an hour is throttled', async () => {
  const ctx = await setup({ limiters: { session: createGuestLimiters().session } });
  try {
    let last = null;
    for (let i = 0; i < 31; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = await ctx.call('POST', SESSIONS, { stayToken: 'guess' });
      if (i < 30) assert.equal(last.status, 404);
    }
    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, 'TOO_MANY_REQUESTS');
  } finally {
    await ctx.close();
  }
});

withApi('rule 8: /me carries the first name, the instants and the party size, nothing else of the stay', async ({ call, db }) => {
  await openStay(call, db, addStay(db));
  const me = await call('GET', '/public/v1/guest/me');
  const { data } = me.body;
  assert.deepEqual(data.guest, { firstName: 'Marie' });
  assert.deepEqual(data.stay, {
    arrival: '2099-07-06T16:00:00+02:00',
    departure: '2099-07-09T10:00:00+02:00',
    partySize: 3,
    statusLine: 'Jour 2 sur 4',
  });
  const text = JSON.stringify(me.body);
  ['marie@example.test', '0600000000', 'Secret', 'Goff', 'R-99-001', 'clientId', 'price', 'total'].forEach((secret) => {
    assert.equal(text.includes(secret), false, secret);
  });
  assert.equal(me.headers.get('cache-control'), 'no-store');
});

withApi('rule 9: past the window the session is dead, its cookie cleared', async ({ call, db, clock }) => {
  await openStay(call, db, addStay(db));
  clock.now = paris('2099-07-09', '12:00');
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.status, 401);
  assert.equal(me.body.error.code, 'SESSION_EXPIRED');
  assert.match(me.setCookie, /gf_guest=;/);
});

withApi('rule 9: a cancelled or deleted reservation kills its sessions on the next request', async ({ call, db, cookies }) => {
  const id = addStay(db);
  await openStay(call, db, id);
  const cookie = cookies.value;
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(id);
  assert.equal((await call('GET', '/public/v1/guest/me', null, { cookie })).status, 401);
  db.prepare("UPDATE reservations SET kind = 'reservation' WHERE id = ?").run(id);
  assert.equal((await call('GET', '/public/v1/guest/me', null, { cookie })).status, 200);
  db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
  assert.equal((await call('GET', '/public/v1/guest/me', null, { cookie })).status, 401);
});

withApi('rule 9 edge case: dates changed by the operator move the expiry and the cookie', async ({ call, db, clock }) => {
  const id = addStay(db);
  await openStay(call, db, id);
  db.prepare("UPDATE reservations SET endDate = '2099-07-12' WHERE id = ?").run(id);
  clock.now = paris('2099-07-10', '12:00');
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.status, 200);
  assert.match(me.setCookie, /Expires=Sun, 12 Jul 2099 10:00:00 GMT/);
  assert.equal(db.prepare('SELECT expiresAt FROM guest_sessions').get().expiresAt, '2099-07-12T10:00:00.000Z');
});

withApi('rule 9 data model: a session row is purged 30 days after its expiry, not before', async ({ call, db, api }) => {
  await openStay(call, db, addStay(db));
  const expiry = new Date('2099-07-09T10:00:00.000Z').getTime();
  const DAY = 24 * 60 * 60 * 1000;
  assert.equal(api.sessions().purgeExpired(new Date(expiry + 29 * DAY)), 0);
  assert.equal(api.sessions().purgeExpired(new Date(expiry + 31 * DAY)), 1);
});

withApi('rules 1, 9: a regenerated link kills every session opened from it at once, not the lookup ones', async ({ call, db, cookies }) => {
  const id = addStay(db);
  await openStay(call, db, id);
  const fromLink = cookies.value;
  cookies.value = null;
  await call('POST', '/public/v1/guest/sessions/lookup', LOOKUP);
  const fromLookup = cookies.value;
  require('../models/stayLinksModel')(db).regenerate(id, new Date());
  const dead = await call('GET', '/public/v1/guest/me', null, { cookie: fromLink });
  assert.equal(dead.status, 401);
  assert.equal(dead.body.error.code, 'SESSION_EXPIRED');
  assert.equal((await call('GET', '/public/v1/guest/me', null, { cookie: fromLookup })).status, 200);
  assert.equal((await openStay(call, db, id)).body.data.mode, 'stay', 'the new link opens the stay');
});

withApi('rule 6: a lookup on the device that opened the link reuses its session', async ({ call, db }) => {
  await openStay(call, db, addStay(db));
  await call('POST', '/public/v1/guest/sessions/lookup', LOOKUP);
  assert.equal(countSessions(db), 1);
});

withApi('rule 19: the language is the guest’s, and ?lang= switches it', async ({ call, db }) => {
  const id = addStay(db);
  db.prepare("UPDATE clients SET emailLanguage = 'en'").run();
  await openStay(call, db, id);
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.body.data.language, 'en');
  assert.equal(me.body.data.stay.statusLine, 'Day 2 of 4');
  assert.equal((await call('GET', '/public/v1/guest/me?lang=fr')).body.data.language, 'fr');
});

withApi('rule 11: an order delivered in the last hour lights the home’s card', async ({ call, db, clock }) => {
  const id = addStay(db);
  await openStay(call, db, id);
  db.prepare(`INSERT INTO guest_orders (reservationId, payment, status, linesJson, createdAt, deliveredAt)
    VALUES (?, 'note', 'delivered', '[]', ?, ?)`).run(id, clock.now.toISOString(), clock.now.toISOString());
  assert.equal((await call('GET', '/public/v1/guest/me')).body.data.highlight.key, 'order');
  clock.now = new Date(clock.now.getTime() + 61 * 60 * 1000);
  assert.equal((await call('GET', '/public/v1/guest/me')).body.data.highlight, undefined);
});
