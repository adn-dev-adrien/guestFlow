// specs/guest-app.md rules 6 and 54 — « Retrouver mon séjour » finds every live stay by its client's last name and its
// reservation number, a direct stay by the number GuestFlow gave it included (Adrien, 2026-11-12: decision D28 of
// 2026-11-10 reversed). The surname still has to match, and « Régénérer le lien » ends the lookup sessions of the stay.
// Far-future dates on an injected clock.
const test = require('node:test');
const assert = require('node:assert/strict');

const { addStay, enable, freshDb, startApi } = require('./guestAppFixtures');
const platformNames = require('../../../utils/platformNameFormat');

const LOOKUP = '/public/v1/guest/sessions/lookup';
const NAME = 'Le Goff-Durand';
const countLookups = (db) => db.prepare("SELECT COUNT(*) AS n FROM guest_sessions WHERE origin = 'lookup'").get().n;

function withApi(name, fn) {
  test(name, async () => {
    const db = freshDb();
    const ctx = await startApi(db, { guestHost: 'sejour.example.test' });
    enable(ctx.api, db);
    try {
      await fn({ db, ...ctx });
    } finally {
      platformNames.setDirectChannels([]);
      await ctx.close();
    }
  });
}

const refused = (res) => {
  assert.equal(res.status, 404, JSON.stringify(res.body));
  assert.equal(res.body.error.code, 'STAY_NOT_FOUND');
  assert.equal(res.setCookie, null);
};

withApi('rule 54: a direct stay opens with the number GuestFlow gave it and its client’s last name', async ({ call, db }) => {
  addStay(db, { reservationNumber: '209907005', platform: 'direct' });
  addStay(db, { reservationNumber: '2099-07-006', platform: 'direct' });
  for (const reservationNumber of ['209907005', '2099-07-006']) {
    // eslint-disable-next-line no-await-in-loop
    const opened = await call('POST', LOOKUP, { lastName: NAME, reservationNumber }, { cookie: null });
    assert.equal(opened.status, 200, `${reservationNumber}: ${JSON.stringify(opened.body)}`);
    assert.equal(opened.body.data.mode, 'stay');
  }
  assert.equal(countLookups(db), 2);
});

withApi('rule 54: a direct stay still needs its client’s last name — another surname opens nothing', async ({ call, db }) => {
  addStay(db, { reservationNumber: '209907005', platform: 'direct' });
  refused(await call('POST', LOOKUP, { lastName: 'Martin', reservationNumber: '209907005' }));
  refused(await call('POST', LOOKUP, { lastName: NAME, reservationNumber: '209907004' }));
  assert.equal(countLookups(db), 0);
});

withApi('rule 54: a platform counted as a direct sale opens like any other', async ({ call, db }) => {
  platformNames.setDirectChannels(['Ownsite']);
  addStay(db, { reservationNumber: 'OWN-42', platform: 'Ownsite' });
  assert.equal((await call('POST', LOOKUP, { lastName: NAME, reservationNumber: 'OWN-42' })).status, 200);
});

withApi('rule 54: a lookup session survives its stay becoming an own-channel sale', async ({ call, db }) => {
  const id = addStay(db, { reservationNumber: 'HMABC123', platform: 'Otaexample' });
  await call('POST', LOOKUP, { lastName: NAME, reservationNumber: 'HMABC123' });
  db.prepare("UPDATE reservations SET platform = 'direct' WHERE id = ?").run(id);
  assert.equal((await call('GET', '/public/v1/guest/me')).status, 200);
});

withApi('rule 54: « Régénérer le lien » ends the lookup sessions of that stay, not another stay’s', async ({ call, db, cookies }) => {
  const id = addStay(db, { reservationNumber: '209907005', platform: 'direct' });
  addStay(db, { reservationNumber: 'HMXYZ789', platform: 'Otaexample', propertyId: 1 });
  await call('POST', LOOKUP, { lastName: NAME, reservationNumber: '209907005' });
  const victim = cookies.value;
  cookies.value = null;
  await call('POST', LOOKUP, { lastName: NAME, reservationNumber: 'HMXYZ789' });
  const other = cookies.value;
  const regenerated = await call('POST', `/api/guest-app/reservations/${id}/stay-link/regenerate`, {});
  assert.equal(regenerated.status, 200, JSON.stringify(regenerated.body));
  const dead = await call('GET', '/public/v1/guest/me', null, { cookie: victim });
  assert.equal(dead.status, 401);
  assert.equal(dead.body.error.code, 'SESSION_EXPIRED');
  assert.equal((await call('GET', '/public/v1/guest/me', null, { cookie: other })).status, 200, 'another stay keeps its session');
  const read = await call('GET', `/api/guest-app/reservations/${id}/stay-link`);
  assert.equal(read.status, 200);
  assert.equal(countLookups(db), 1, 'reading the link ends nothing');
});

withApi('rule 54: 10-digit platform numbers open their stay, digits 5-6 between 01 and 12 included', async ({ call, db }) => {
  const numbers = ['4089123456', '5310061234', '2026110012', '4512345678', '2099071234'];
  numbers.forEach((reservationNumber) => addStay(db, { reservationNumber, platform: 'Booking.com' }));
  for (const reservationNumber of numbers) {
    // eslint-disable-next-line no-await-in-loop
    const opened = await call('POST', LOOKUP, { lastName: NAME, reservationNumber }, { cookie: null });
    assert.equal(opened.status, 200, `${reservationNumber}: ${JSON.stringify(opened.body)}`);
  }
  assert.equal(countLookups(db), numbers.length);
});
