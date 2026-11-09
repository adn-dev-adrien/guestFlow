// specs/guest-app.md rule 15bis — the one Soliomap event the home suggests. The feed is a trimmed copy of Soliomap's
// real `/api/activities` (2026-11-05): its dates are the snapshot's own, so every clock below is injected and handed
// only to the picker or to the plugin under test (date-literal-ok on each line that carries one). No network.
const test = require('node:test');
const assert = require('node:assert/strict');

const FEED = require('./soliomapActivities.json');
const {
  CACHE_MS, FAILURE_CACHE_MS, TIMEOUT_MS, createSoliomapFeed, pickSuggestion,
} = require('../soliomapFeed');
const {
  addStay, enable, freshDb, latestStayToken, startApi,
} = require('./guestAppFixtures');

const URL = 'https://map.example.test';
const paris = (ymd, time) => new Date(`${ymd}T${time}:00+01:00`);
const pick = ({ mode = 'stay', stay, now, lang = 'fr', activities = FEED.activities }) => pickSuggestion(activities, {
  mode, stay, now, lang, soliomapUrl: URL,
});

test('rule 15bis: the nearest event of the days left, with its date, drive time and permalink', () => {
  // date-literal-ok: the snapshot's week, handed to the pure picker only
  const card = pick({ stay: { startDate: '2026-11-05', endDate: '2026-11-09' }, now: paris('2026-11-06', '12:00') });
  assert.deepEqual(card, {
    id: 'theatre-chiche-t-es-pas-cap',
    name: 'Théâtre : Chiche, t\'es pas cap !',
    category: 'Patrimoine', // Soliomap's lower-case category, shown as a label
    dateLabel: 'sam. 7 nov.',
    driveLabel: '8 min en voiture',
    url: `${URL}/#theatre-chiche-t-es-pas-cap`,
  });
});

test('rule 15bis: from 14 h the suggestion counts from tomorrow; a multi-day event reads its real end', () => {
  // date-literal-ok: the snapshot's week, handed to the pure picker only
  const stay = { startDate: '2026-11-05', endDate: '2026-11-10' };
  // date-literal-ok: the clock handed to the picker
  assert.equal(pick({ stay, now: paris('2026-11-07', '13:59') }).id, 'theatre-chiche-t-es-pas-cap', 'today still counts');
  // date-literal-ok: the clock handed to the picker
  const late = pick({ stay, now: paris('2026-11-07', '14:00') });
  assert.equal(late.id, 'exposition-et-animation-autour-de-l-astronomie', 'today\'s events are gone, the exhibition runs on');
  assert.equal(late.dateLabel, 'jusqu’au sam. 28 nov.');
  assert.equal(late.driveLabel, '27 min en voiture');
  // date-literal-ok: the clock handed to the picker
  const en = pick({ stay, now: paris('2026-11-07', '14:00'), lang: 'en' });
  assert.equal(en.dateLabel, 'until Sat 28 Nov');
  assert.equal(en.driveLabel, '27 min drive');
});

test('rule 15bis: the departure day is not a day of the stay — up to its eve only', () => {
  // date-literal-ok: the snapshot's week, handed to the pure picker only
  const now = paris('2026-11-10', '10:00');
  // date-literal-ok: the snapshot's week, handed to the pure picker only
  assert.equal(pick({ stay: { startDate: '2026-11-10', endDate: '2026-11-13' }, now }).id, 'exposition-et-animation-autour-de-l-astronomie', 'the 4-min screening is on the departure day');
  // date-literal-ok: the snapshot's week, handed to the pure picker only
  assert.equal(pick({ stay: { startDate: '2026-11-10', endDate: '2026-11-14' }, now }).id, 'projection-ardeche-le-film-documentaire-2026', 'one night more: the screening is in');
  // date-literal-ok: the snapshot's week, handed to the pure picker only
  assert.equal(pick({ stay: { startDate: '2026-11-07', endDate: '2026-11-08' }, now: paris('2026-11-07', '15:00') }), null, 'no day left → no card');
});

test('rule 15bis: an event shows once its visibleFrom is reached; pre-arrival counts from the arrival day', () => {
  // date-literal-ok: the snapshot's week, handed to the pure picker only
  const stay = { startDate: '2026-11-14', endDate: '2026-11-17' };
  // date-literal-ok: the clock handed to the picker
  const before = pick({ mode: 'preArrival', stay, now: paris('2026-10-31', '18:00') });
  assert.equal(before.id, 'exposition-et-animation-autour-de-l-astronomie', 'the Christmas market is not visible yet');
  // date-literal-ok: the clock handed to the picker
  assert.equal(pick({ mode: 'preArrival', stay, now: paris('2026-11-01', '09:00') }).id, 'marche-de-noel-2026-92c0e0', 'visible from the 1st, 4 min away');
});

test('rule 15bis: same drive time → the soonest', () => {
  // date-literal-ok: the snapshot's week, handed to the pure picker only
  const card = pick({ stay: { startDate: '2026-11-12', endDate: '2026-11-17' }, now: paris('2026-11-12', '10:00') });
  assert.equal(card.id, 'projection-ardeche-le-film-documentaire-2026', 'the 13th before the 15th, both 4 min away');
});

test('rule 15bis: a visitor, an activity without dates or a feed that could not be read → no card', () => {
  // date-literal-ok: the snapshot's week, handed to the pure picker only
  const stay = { startDate: '2026-11-05', endDate: '2026-11-09' };
  // date-literal-ok: the clock handed to the picker
  const now = paris('2026-11-06', '12:00');
  assert.equal(pick({ mode: 'visitor', stay, now }), null);
  assert.equal(pick({ stay, now, activities: FEED.activities.filter((a) => !a.startsOn) }), null, 'places are not events');
  assert.equal(pick({ stay, now, activities: null }), null);
  assert.equal(pickSuggestion(FEED.activities, { mode: 'stay', stay, now, soliomapUrl: '' }), null, 'no Soliomap URL');
});

test('rule 15bis: the feed is read once an hour, a failure is no card and is retried a few minutes later', async () => {
  const clock = { now: new Date(Date.UTC(2099, 0, 1)) };
  let calls = 0;
  let answer = () => FEED;
  const feed = createSoliomapFeed({ url: () => URL, now: () => clock.now, fetchFeed: async (url) => { calls += 1; assert.equal(url, `${URL}/api/activities`); return answer(); } });
  assert.equal((await feed.activities()).length, FEED.activities.length);
  await feed.activities();
  assert.equal(calls, 1, 'cached');
  clock.now = new Date(clock.now.getTime() + CACHE_MS);
  answer = () => { throw new Error('down'); };
  assert.equal(await feed.activities(), null, 'Soliomap down → nothing');
  clock.now = new Date(clock.now.getTime() + FAILURE_CACHE_MS - 1);
  assert.equal(await feed.activities(), null);
  assert.equal(calls, 2, 'the failure is remembered');
  answer = () => FEED;
  clock.now = new Date(clock.now.getTime() + 1);
  assert.equal((await feed.activities()).length, FEED.activities.length, 'retried');
  assert.equal(CACHE_MS, 60 * 60 * 1000);
});

test('rule 15bis: a slow Soliomap is given 5 s, then no card; a body without activities is no card', async () => {
  assert.equal(TIMEOUT_MS, 5000);
  let aborted = false;
  const slow = createSoliomapFeed({
    url: () => URL,
    timeoutMs: 20,
    fetchFeed: (url, { signal }) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); }),
  });
  assert.equal(await slow.activities(), null);
  assert.equal(aborted, true, 'the request is aborted');
  const odd = createSoliomapFeed({ url: () => URL, fetchFeed: async () => ({ version: 1 }) });
  assert.equal(await odd.activities(), null);
});

test('rule 15bis: /me carries the suggestion for a stay session, never for a visitor nor with Soliomap off', async () => {
  const db = freshDb();
  const soliomapFeed = createSoliomapFeed({ url: () => URL, fetchFeed: async () => FEED });
  const ctx = await startApi(db, { soliomapUrl: URL, soliomapFeed });
  try {
    const code = enable(ctx.api, db);
    // date-literal-ok: the clock injected into the plugin, matching the snapshot's week
    ctx.clock.now = paris('2026-11-06', '12:00');
    await ctx.call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
    assert.equal((await ctx.call('GET', '/public/v1/guest/me')).body.data.suggestion, undefined, 'a visitor has none');

    // date-literal-ok: the stay handed to the plugin with its injected clock
    addStay(db, { startDate: '2026-11-05', endDate: '2026-11-09' });
    ctx.cookies.value = null;
    await ctx.call('POST', '/public/v1/guest/sessions', { stayToken: latestStayToken(db) });
    const me = await ctx.call('GET', '/public/v1/guest/me');
    assert.equal(me.body.data.mode, 'stay');
    assert.equal(me.body.data.suggestion.id, 'theatre-chiche-t-es-pas-cap');

    const modules = require('../modules').defaultModules().map((m) => (m.key === 'soliomap' ? { ...m, on: false } : m));
    require('../models/lodgingsModel')(db).save(1, { modules });
    assert.equal((await ctx.call('GET', '/public/v1/guest/me')).body.data.suggestion, undefined, 'module off');
  } finally {
    await ctx.close();
  }
});
