// specs/guest-app.md rule 48 — the studio reads GuestFlow live: every property in GuestFlow's order with its own name,
// a new one listed at once and greyed « Hors application », a renamed one renamed, nothing named by the plugin; the app
// settings read and written in one place; « Synchroniser » re-reads the Soliomap feed, the only thing cached.
const test = require('node:test');
const assert = require('node:assert/strict');

const { enable, freshDb, startApi } = require('./guestAppFixtures');
const { memorySettings } = require('..');
const { createSoliomapFeed } = require('../soliomapFeed');
const { agoLabel } = require('../controllers/studioSettingsController');

function withStudio(name, fn, options = {}) {
  test(name, async () => {
    const db = freshDb();
    const store = memorySettings();
    let reads = 0;
    const feedClock = { at: new Date('2099-07-07T10:00:00Z') };
    const soliomapFeed = createSoliomapFeed({
      url: () => store.get('soliomapUrl'),
      now: () => feedClock.at,
      fetchFeed: async () => { reads += 1; return { activities: [{ id: 'a', name: 'Marché' }] }; },
    });
    const ctx = await startApi(db, { settingsStore: () => store, soliomapFeed, ...options });
    try {
      await fn({ db, store, reads: () => reads, ...ctx, feedClock });
    } finally {
      await ctx.close();
    }
  });
}

withStudio('rule 48: every GuestFlow property, in its order, its live name; a new one greyed « Hors application »', async ({ db, api, call }) => {
  enable(api, db, 2);
  const first = (await call('GET', '/api/guest-app/studio/lodgings')).body.lodgings;
  assert.deepEqual(first.map((l) => [l.name, l.enabled, l.stateLabel]), [['L\'Estiva', true, null], ['La Granja', false, 'Hors application']]);
  db.prepare("INSERT INTO properties (id, name) VALUES (3, 'Le Mazet')").run();
  db.prepare("UPDATE properties SET name = 'L''Estiva du haut' WHERE id = 2").run();
  const second = (await call('GET', '/api/guest-app/studio/lodgings')).body.lodgings;
  assert.deepEqual(second.map((l) => l.name), ['L\'Estiva du haut', 'La Granja', 'Le Mazet']);
  assert.deepEqual(second.find((l) => l.propertyId === 3), {
    propertyId: 3, name: 'Le Mazet', enabled: false, hasLodgingCode: false, stateLabel: 'Hors application',
  });
  assert.equal((await call('GET', '/api/guest-app/lodgings/2')).body.name, 'L\'Estiva du haut');
  assert.equal((await call('GET', '/api/guest-app/lodgings/2')).body.displayName, undefined, 'the plugin names nothing');
});

withStudio('rule 48: the app settings in one read; a write judges every key and refuses an unknown one', async ({ call, store }) => {
  const read = (await call('GET', '/api/guest-app/studio/settings')).body;
  assert.deepEqual(
    [read.appName, read.soliomapUrl, read.soliomapEmbed, read.maxOrderTotal, read.fulfilment, read.soliomap.syncedLabel],
    ['Domaine Solio', 'https://map.domainesolio.com', false, 500, 'delivery', 'Pas encore synchronisé'],
  );
  const saved = await call('PUT', '/api/guest-app/studio/settings', {
    appName: 'Mon séjour', guestHost: 'sejour.domainesolio.com', soliomapEmbed: true, maxOrderTotal: 300,
  });
  assert.equal(saved.status, 200);
  assert.deepEqual([saved.body.appName, saved.body.guestHost, saved.body.soliomapEmbed, saved.body.maxOrderTotal], ['Mon séjour', 'sejour.domainesolio.com', true, 300]);
  assert.equal(store.get('soliomapEmbed'), '1');
  for (const body of [{ guestHost: 'not a host' }, { soliomapUrl: 'http://map.example.test' }, { maxOrderTotal: 0 }, { colour: 'red' }, { soliomapEmbed: 'yes' }]) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await call('PUT', '/api/guest-app/studio/settings', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(store.get('guestHost'), 'sejour.domainesolio.com');
});

withStudio('rule 48: « Synchroniser » reads Soliomap again at once, and says when', async ({ call, clock, feedClock, reads }) => {
  const first = (await call('POST', '/api/guest-app/studio/soliomap/sync')).body;
  assert.deepEqual([first.ok, first.count, first.syncedLabel], [true, 1, 'Synchronisé à l’instant']);
  clock.now = new Date(feedClock.at.getTime() + 2 * 60 * 1000);
  assert.equal((await call('GET', '/api/guest-app/studio/settings')).body.soliomap.syncedLabel, 'Synchronisé il y a 2 min');
  await call('POST', '/api/guest-app/studio/soliomap/sync');
  assert.equal(reads(), 2, 'the hour of cache does not hold the button back');
  assert.equal(agoLabel(new Date('2099-07-07T07:00:00Z'), new Date('2099-07-07T10:00:00Z')), 'Synchronisé il y a 3 h');
});

withStudio('rule 48: without a Soliomap address there is nothing to synchronise', async ({ call, store }) => {
  store.set('soliomapUrl', '');
  assert.equal((await call('POST', '/api/guest-app/studio/soliomap/sync')).status, 409);
});
