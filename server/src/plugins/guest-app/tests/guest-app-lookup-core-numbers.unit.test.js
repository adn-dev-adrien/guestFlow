// specs/guest-app.md rules 6 and 54, decision D28 (audit R36 A36-1) — « Retrouver mon séjour » never opens a stay whose
// number the core made: sequential, a surname was enough to walk through them and hold the gate and the note. Judged by
// the platform's mode (own channel), never its name; a platform stay still carrying the core's number is refused too.
// « Régénérer le lien » ends the lookup sessions of the stay. Far-future dates on an injected clock.
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

withApi('D28: a direct stay is never opened by its sequential number, the right surname included (the auditor’s walk)', async ({ call, db }) => {
  ['209907005', '209907006', '209907007', '209907008'].forEach((reservationNumber) => addStay(db, { reservationNumber, platform: 'direct' }));
  for (const reservationNumber of ['209907005', '209907006', '209907007', '209907008', '209907009']) {
    // eslint-disable-next-line no-await-in-loop
    refused(await call('POST', LOOKUP, { lastName: NAME, reservationNumber }));
  }
  assert.equal(countLookups(db), 0);
});

withApi('D28: judged by the platform’s mode — a platform counted as a direct sale is refused, whatever its number', async ({ call, db }) => {
  addStay(db, { reservationNumber: 'OWN-42', platform: 'Ownsite' });
  assert.equal((await call('POST', LOOKUP, { lastName: NAME, reservationNumber: 'OWN-42' })).status, 200, 'not counted as direct: opened');
  platformNames.setDirectChannels(['Ownsite']);
  refused(await call('POST', LOOKUP, { lastName: NAME, reservationNumber: 'OWN-42' }, { cookie: null }));
});

withApi('D28: a platform stay still carrying the core’s number is refused; its own number opens it', async ({ call, db }) => {
  addStay(db, { reservationNumber: '209907003', platform: 'Otaexample' });
  addStay(db, { reservationNumber: '2099-07-004', platform: 'Otaexample' });
  addStay(db, { reservationNumber: 'HMABC123', platform: 'Otaexample' });
  refused(await call('POST', LOOKUP, { lastName: NAME, reservationNumber: '209907003' }));
  refused(await call('POST', LOOKUP, { lastName: NAME, reservationNumber: '2099-07-004' }));
  const opened = await call('POST', LOOKUP, { lastName: NAME, reservationNumber: 'HMABC123' });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.data.mode, 'stay');
});

withApi('D28: a lookup session opened before its stay became an own-channel sale dies on its next request', async ({ call, db }) => {
  const id = addStay(db, { reservationNumber: 'HMABC123', platform: 'Otaexample' });
  await call('POST', LOOKUP, { lastName: NAME, reservationNumber: 'HMABC123' });
  assert.equal((await call('GET', '/public/v1/guest/me')).status, 200);
  db.prepare("UPDATE reservations SET platform = 'direct' WHERE id = ?").run(id);
  const dead = await call('GET', '/public/v1/guest/me');
  assert.equal(dead.status, 401);
  assert.equal(dead.body.error.code, 'SESSION_EXPIRED');
});

withApi('D28, rule 54: « Régénérer le lien » ends the lookup sessions of that stay, not another stay’s', async ({ call, db, cookies }) => {
  const id = addStay(db, { reservationNumber: 'HMABC123', platform: 'Otaexample' });
  addStay(db, { reservationNumber: 'HMXYZ789', platform: 'Otaexample', propertyId: 1 });
  await call('POST', LOOKUP, { lastName: NAME, reservationNumber: 'HMABC123' });
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
