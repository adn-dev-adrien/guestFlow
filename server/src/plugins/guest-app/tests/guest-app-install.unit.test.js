// specs/guest-app.md rules 52, 53 (§6.1) — the installable app: its manifest carries the studio's app name and the
// fir-green theme, readable before any session and revalidated on each read; and the night register, decided by the
// server from sunset to sunrise at the estate, so every device of a stay switches at the same moment.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addStay, enable, freshDb, latestStayToken, paris, startApi,
} = require('./guestAppFixtures');
const { isNight, sunTimes } = require('../sun');
const { webManifest } = require('../webManifest');

async function withApi(fn, options = {}) {
  const db = freshDb();
  const ctx = await startApi(db, options);
  try {
    await fn({ db, ...ctx });
  } finally {
    await ctx.close();
  }
}

test('rule 52: GET /manifest.webmanifest — the app name from the studio, standalone, fir-green, no session needed', () => withApi(async ({ base }) => {
  const res = await fetch(`${base}/public/v1/guest/manifest.webmanifest`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/manifest\+json/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  const manifest = await res.json();
  assert.deepEqual(
    [manifest.name, manifest.display, manifest.theme_color, manifest.background_color, manifest.start_url, manifest.scope],
    ['Domaine Solio', 'standalone', '#2E3B2A', '#F5F0E6', '/', '/'],
  );
  assert.deepEqual(manifest.icons.map((i) => i.src), ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png']);
}));

test('rule 52: an app name longer than a home-screen label keeps « Mon séjour » under the icon', () => {
  assert.equal(webManifest({ appName: 'Domaine Solio — La Granja et L’Estiva' }).short_name, 'Mon séjour');
  assert.equal(webManifest({ appName: '' }).name, 'Mon séjour');
});

test('rule 53: /me says `isNight` from sunset to sunrise at the estate', () => withApi(async ({ db, api, call, clock }) => {
  enable(api, db, 1);
  addStay(db);
  await call('POST', '/public/v1/guest/sessions', { stayToken: latestStayToken(db) });
  clock.now = paris('2099-07-07', '12:00');
  assert.equal((await call('GET', '/public/v1/guest/me')).body.data.isNight, false);
  clock.now = paris('2099-07-07', '23:30');
  assert.equal((await call('GET', '/public/v1/guest/me')).body.data.isNight, true);
}));

test('rule 53: sunset and sunrise follow the season — 18:00 is night in December, 21:00 still day in June', () => {
  const june = sunTimes(new Date('2026-06-21T12:00:00Z')); // date-literal-ok: an input of the pure sun calculation, compared with nothing
  const december = sunTimes(new Date('2026-12-21T12:00:00Z')); // date-literal-ok: an input of the pure sun calculation, compared with nothing
  assert.ok(june.sunset.getTime() - june.sunrise.getTime() > 15 * 3600 * 1000);
  assert.ok(december.sunset.getTime() - december.sunrise.getTime() < 9 * 3600 * 1000);
  assert.equal(isNight(new Date('2026-06-21T19:00:00Z')), false, '21:00 in Paris, June'); // date-literal-ok: an input of the pure sun calculation, compared with nothing
  assert.equal(isNight(new Date('2026-12-21T17:00:00Z')), true, '18:00 in Paris, December'); // date-literal-ok: an input of the pure sun calculation, compared with nothing
  assert.equal(isNight(new Date('2026-12-21T05:00:00Z')), true, '06:00 in Paris, December'); // date-literal-ok: an input of the pure sun calculation, compared with nothing
});
