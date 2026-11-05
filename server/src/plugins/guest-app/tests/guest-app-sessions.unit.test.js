// specs/guest-app.md rules 1, 4, 5, 6, 8, 9 and 33's name lock — through the plugin's real routes, on an
// in-memory database and an injected clock (far-future dates, nothing compared with today).
const test = require('node:test');
const assert = require('node:assert/strict');

const sdk = require('../../sdk');
const { addStay, enable, freshDb, paris, startApi } = require('./guestAppFixtures');

const rateLimiters = sdk.coreModule('rateLimiters');

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

withApi('rule 1: a guessed code answers 404, like a disabled one (no oracle)', async ({ call, db, code }) => {
  const unknown = await call('POST', '/public/v1/guest/sessions', { lodgingCode: 'guess' });
  assert.equal(unknown.status, 404);
  db.prepare('UPDATE guest_app_lodgings SET enabled = 0').run();
  const disabled = await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  assert.deepEqual(disabled.body, unknown.body);
  assert.equal(disabled.status, 404);
  assert.equal(unknown.setCookie, null);
});

withApi('rule 1: the lodging code holds 128 random bits in base64url', async ({ code }) => {
  assert.match(code, /^[A-Za-z0-9_-]{22}$/);
});

withApi('rule 2: scanning opens the current stay of that lodging', async ({ call, db, code }) => {
  addStay(db);
  addStay(db, { propertyId: 2, reservationNumber: 'R-99-002' });
  const res = await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.mode, 'stay');
  assert.deepEqual(res.body.data.lodging, { id: 1, name: 'La Granja', slug: 'la-granja' });
});

withApi('rule 4: the cookie is HttpOnly, Secure, SameSite=Strict and expires with the window; only its hash is stored', async ({ call, db, code }) => {
  addStay(db);
  const { setCookie } = await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
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
});

withApi('rule 4: the same device rescanning during the same stay reuses its session', async ({ call, db, code }) => {
  addStay(db);
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_sessions').get().n, 1);
});

withApi('rule 4: two devices have two sessions on the same stay', async ({ call, db, code, cookies }) => {
  addStay(db);
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  cookies.value = null;
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_sessions').get().n, 2);
});

withApi('rule 5: no stay → visitor mode, no personal data', async ({ call, code }) => {
  const created = await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  assert.equal(created.body.data.mode, 'visitor');
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.data.mode, 'visitor');
  assert.equal(me.body.data.welcome, 'Bienvenue à La Granja');
  assert.equal(me.body.data.guest, undefined);
  assert.equal(me.body.data.stay, undefined);
  const keys = me.body.data.tiles.map((t) => t.key);
  assert.equal(keys.includes('gate'), false);
  assert.equal(keys.includes('shop'), false);
  assert.ok(keys.includes('booklet'));
  assert.ok(keys.includes('soliomap'));
});

withApi('rule 5: scanned too early, the server says when it opens, and the session ends right then', async ({ call, db, code, clock }) => {
  addStay(db, { startDate: '2099-07-07', endDate: '2099-07-09' });
  clock.now = paris('2099-07-07', '11:00');
  const created = await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  assert.equal(created.body.data.mode, 'visitor');
  assert.equal(created.body.data.opensAt, '2099-07-07T11:00:00.000Z');
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.body.data.openingLine, 'Votre séjour commence aujourd’hui à 16 h — le portail et la boutique s’ouvriront à 13 h.');
  clock.now = paris('2099-07-07', '13:00');
  assert.equal((await call('GET', '/public/v1/guest/me')).status, 401);
  const again = await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  assert.equal(again.body.data.mode, 'stay');
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
  assert.equal(me.body.data.nameConfirmed, true);
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
  const ctx = await setup({ limiters: { lookup: rateLimiters.guestLookupLimiter } });
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

test('§4.3: the 31st scan in an hour is throttled', async () => {
  const ctx = await setup({ limiters: { session: rateLimiters.guestSessionLimiter } });
  try {
    let last = null;
    for (let i = 0; i < 31; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = await ctx.call('POST', '/public/v1/guest/sessions', { lodgingCode: 'guess' });
      if (i < 30) assert.equal(last.status, 404);
    }
    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, 'TOO_MANY_REQUESTS');
  } finally {
    await ctx.close();
  }
});

withApi('rule 8: /me carries the first name, the instants and the party size, nothing else of the stay', async ({ call, db, code }) => {
  addStay(db);
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
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

withApi('rule 9: past the window the session is dead, its cookie cleared', async ({ call, db, code, clock }) => {
  addStay(db);
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  clock.now = paris('2099-07-09', '12:00');
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.status, 401);
  assert.equal(me.body.error.code, 'SESSION_EXPIRED');
  assert.match(me.setCookie, /gf_guest=;/);
});

withApi('rule 9: a cancelled or deleted reservation kills its sessions on the next request', async ({ call, db, code, cookies }) => {
  const id = addStay(db);
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  const cookie = cookies.value;
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(id);
  assert.equal((await call('GET', '/public/v1/guest/me', null, { cookie })).status, 401);
  db.prepare("UPDATE reservations SET kind = 'reservation' WHERE id = ?").run(id);
  assert.equal((await call('GET', '/public/v1/guest/me', null, { cookie })).status, 200);
  db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
  assert.equal((await call('GET', '/public/v1/guest/me', null, { cookie })).status, 401);
});

withApi('rule 9 edge case: dates changed by the operator move the expiry and the cookie', async ({ call, db, code, clock }) => {
  const id = addStay(db);
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  db.prepare("UPDATE reservations SET endDate = '2099-07-12' WHERE id = ?").run(id);
  clock.now = paris('2099-07-10', '12:00');
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.status, 200);
  assert.match(me.setCookie, /Expires=Sun, 12 Jul 2099 10:00:00 GMT/);
  assert.equal(db.prepare('SELECT expiresAt FROM guest_sessions').get().expiresAt, '2099-07-12T10:00:00.000Z');
});

withApi('rule 9 data model: a session row is purged 30 days after its expiry, not before', async ({ call, db, code, api }) => {
  addStay(db);
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  const expiry = new Date('2099-07-09T10:00:00.000Z').getTime();
  const DAY = 24 * 60 * 60 * 1000;
  assert.equal(api.sessions().purgeExpired(new Date(expiry + 29 * DAY)), 0);
  assert.equal(api.sessions().purgeExpired(new Date(expiry + 31 * DAY)), 1);
});

withApi('rule 33: a wrong name counts down, the right one confirms once for the session', async ({ call, db, code }) => {
  addStay(db);
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  assert.equal((await call('GET', '/public/v1/guest/me')).body.data.nameConfirmed, false);
  const wrong = await call('POST', '/public/v1/guest/me/confirm-name', { lastName: 'Martin' });
  assert.equal(wrong.status, 422);
  assert.equal(wrong.body.error.code, 'NAME_MISMATCH');
  assert.equal(wrong.body.error.attemptsLeft, 2);
  const right = await call('POST', '/public/v1/guest/me/confirm-name', { lastName: 'LE GOFF durand' });
  assert.equal(right.status, 200);
  assert.deepEqual(right.body.data, { nameConfirmed: true });
  assert.equal((await call('GET', '/public/v1/guest/me')).body.data.nameConfirmed, true);
  assert.equal((await call('POST', '/public/v1/guest/me/confirm-name', { lastName: 'Martin' })).status, 200);
});

withApi('rule 33: three wrong names lock for one hour, then it opens again', async ({ call, db, code, clock }) => {
  addStay(db);
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  await call('POST', '/public/v1/guest/me/confirm-name', { lastName: 'a' });
  await call('POST', '/public/v1/guest/me/confirm-name', { lastName: 'b' });
  const third = await call('POST', '/public/v1/guest/me/confirm-name', { lastName: 'c' });
  assert.equal(third.status, 423);
  assert.equal(third.body.error.code, 'NAME_LOCKED');
  const locked = await call('POST', '/public/v1/guest/me/confirm-name', { lastName: 'Le Goff-Durand' });
  assert.equal(locked.status, 423);
  clock.now = new Date(clock.now.getTime() + 61 * 60 * 1000);
  const after = await call('POST', '/public/v1/guest/me/confirm-name', { lastName: 'Le Goff-Durand' });
  assert.equal(after.status, 200);
});

withApi('rule 33: a visitor session has no name to confirm', async ({ call, code }) => {
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  const res = await call('POST', '/public/v1/guest/me/confirm-name', { lastName: 'x' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'STAY_REQUIRED');
});

withApi('rule 33: the fallback already proved the name, even on a session opened by QR', async ({ call, db, code }) => {
  addStay(db);
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  await call('POST', '/public/v1/guest/sessions/lookup', LOOKUP);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_sessions').get().n, 1);
  assert.equal((await call('GET', '/public/v1/guest/me')).body.data.nameConfirmed, true);
});

withApi('rule 19: the language is the guest’s, and ?lang= switches it', async ({ call, db, code }) => {
  addStay(db);
  db.prepare("UPDATE clients SET emailLanguage = 'en'").run();
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.body.data.language, 'en');
  assert.equal(me.body.data.stay.statusLine, 'Day 2 of 4');
  assert.equal((await call('GET', '/public/v1/guest/me?lang=fr')).body.data.language, 'fr');
});

withApi('rule 11: an order delivered in the last hour lights the home’s card', async ({ call, db, code, clock }) => {
  const id = addStay(db);
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  db.prepare(`INSERT INTO guest_orders (reservationId, payment, status, linesJson, createdAt, deliveredAt)
    VALUES (?, 'note', 'delivered', '[]', ?, ?)`).run(id, clock.now.toISOString(), clock.now.toISOString());
  assert.equal((await call('GET', '/public/v1/guest/me')).body.data.highlight.key, 'order');
  clock.now = new Date(clock.now.getTime() + 61 * 60 * 1000);
  assert.equal((await call('GET', '/public/v1/guest/me')).body.data.highlight, undefined);
});
