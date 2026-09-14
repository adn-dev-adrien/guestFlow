// specs/gate-access-portier.md §3.1 — the drain of the Portier outbox.
//
// The rows are written by the real hooks against an in-memory database; Portier is a fake client
// injected into the drainer, and time and timers are driven by hand, so the back-off and the « one
// timer only while something fails » rule are observed rather than trusted.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const portierSync = require('../utils/portierSync');
const { PORTIER_OUTBOX_SQL } = require('../utils/portierSchema');
const { PortierUnavailableError } = require('../utils/portierClient');

const { backoffDelay } = portierSync.__test;
const T0 = Date.parse('2026-09-14T08:00:00.000Z');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', propertyId INTEGER, clientId INTEGER,
      startDate TEXT, endDate TEXT, checkInTime TEXT, checkOutTime TEXT, reservationNumber TEXT
    );
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, companyName TEXT, companyLogoPath TEXT);
  `);
  db.exec(PORTIER_OUTBOX_SQL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte'), (2, 'Lodge')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Roux'), (2, 'Léa', 'Martin')").run();
  db.prepare(`INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, checkInTime, checkOutTime, reservationNumber)
              VALUES (11, 1, 1, '2026-09-21', '2026-09-28', '16:00', '10:00', '202609042'),
                     (12, 2, 2, '2026-09-22', '2026-09-24', '17:00', '11:00', '202609051')`).run();
  db.prepare("INSERT INTO app_settings (id, companyName, companyLogoPath) VALUES (1, 'Domaine Solio', '/uploads/company-logo.png')").run();
  return db;
}

function harness(db, { answer } = {}) {
  const clock = { at: T0 };
  const timers = [];
  const calls = [];
  const client = {
    configured: true,
    isConfigured() { return this.configured; },
    async call(request) {
      calls.push(request);
      return answer ? answer(request, calls.length) : { status: 200, data: { result: 'applied' } };
    },
  };
  const drainer = portierSync.createDrainer({
    database: db,
    client,
    now: () => clock.at,
    setTimer: (fn, delay) => {
      const t = { delay, done: false };
      t.fn = () => { t.done = true; return fn(); };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => { if (t) t.done = true; },
    readLogo: () => ({ bytes: Buffer.from('PNGBYTES'), mime: 'image/png' }),
    logger: { warn() {}, error() {} },
  });
  const liveTimers = () => timers.filter((t) => !t.done);
  return { clock, calls, client, drainer, liveTimers };
}

const pending = (db) => db.prepare('SELECT * FROM portier_outbox WHERE sentAt IS NULL ORDER BY id').all();

test('back-off: 30 s, 1, 2, 5 and 15 minutes, then hourly', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 12].map(backoffDelay), [30e3, 60e3, 120e3, 300e3, 900e3, 3600e3, 3600e3]);
});

test('the drain sends in order, the row id as the revision, then arms nothing', async () => {
  const db = makeDb();
  const a = portierSync.pushStay(db, 11);
  const b = portierSync.pushStay(db, 12);
  const c = portierSync.cancelStay(db, 11, 'cancelled');
  const { calls, drainer, liveTimers } = harness(db);

  await drainer.drain();

  assert.deepEqual(calls.map((r) => `${r.method} ${r.path}`), [
    'PUT /svc/v1/stays/11', 'PUT /svc/v1/stays/12', 'POST /svc/v1/stays/11/cancel',
  ]);
  assert.deepEqual(calls.map((r) => r.body.revision), [a, b, c]);
  assert.deepEqual(Object.keys(calls[0].body), ['revision', 'startsAt', 'endsAt', 'propertyName', 'guestFirstName', 'reservationNumber'],
    'the body keys follow the contract order');
  assert.deepEqual(calls[0].body, {
    revision: a,
    startsAt: '2026-09-21T14:00:00.000Z',
    endsAt: '2026-09-28T09:00:00.000Z',
    propertyName: 'Gîte',
    guestFirstName: 'Camille',
    reservationNumber: '202609042',
  });
  assert.deepEqual(calls[2].body, { revision: c, reason: 'cancelled' });
  assert.equal(pending(db).length, 0);
  assert.equal(liveTimers().length, 0, 'nothing failed, nothing is armed');
  assert.equal(drainer.hasTimer(), false);
});

test('an empty outbox arms no timer; an unconfigured Portier keeps every row and arms none', async () => {
  const empty = harness(makeDb());
  await empty.drainer.drain();
  assert.equal(empty.calls.length, 0);
  assert.equal(empty.liveTimers().length, 0);

  const db = makeDb();
  portierSync.pushStay(db, 11);
  const off = harness(db);
  off.client.configured = false;
  await off.drainer.drain();
  assert.equal(off.calls.length, 0);
  assert.equal(pending(db).length, 1, 'the outbox keeps its rows (§4.2)');
  assert.equal(off.liveTimers().length, 0);
});

test('Portier down: one knock, every due row backs off, ONE timer; back up: the rows leave in order', async () => {
  const db = makeDb();
  const first = portierSync.pushStay(db, 11);
  portierSync.pushStay(db, 12);
  let up = false;
  const { clock, calls, drainer, liveTimers } = harness(db, {
    answer: () => {
      if (!up) throw new PortierUnavailableError('unreachable', 'ECONNREFUSED');
      return { status: 200, data: { result: 'applied' } };
    },
  });

  await drainer.drain();
  assert.equal(calls.length, 1, 'an outage is not hammered row by row');
  const rows = pending(db);
  assert.deepEqual(rows.map((r) => [r.attempts, r.nextAttemptAt]), [
    [1, '2026-09-14T08:00:30.000Z'], [1, '2026-09-14T08:00:30.000Z'],
  ]);
  assert.equal(liveTimers().length, 1);
  assert.equal(liveTimers()[0].delay, 30e3);

  clock.at = T0 + 30e3;
  await liveTimers()[0].fn();
  assert.equal(pending(db)[0].attempts, 2);
  assert.equal(pending(db)[0].nextAttemptAt, '2026-09-14T08:01:30.000Z', 'the second failure waits one minute');
  assert.equal(liveTimers().length, 1, 'still exactly one timer');

  up = true;
  clock.at = T0 + 90e3;
  await liveTimers()[0].fn();
  assert.equal(pending(db).length, 0);
  assert.equal(calls.at(-2).body.revision, first, 'the oldest row leaves first');
  assert.equal(liveTimers().length, 0, 'the outbox is empty, the timer is gone');
});

test('a row waiting for its retry holds back the later rows of ITS reservation only', async () => {
  const db = makeDb();
  const stuck = portierSync.pushStay(db, 11);
  portierSync.cancelStay(db, 11, 'cancelled');
  portierSync.pushStay(db, 12);
  db.prepare('UPDATE portier_outbox SET attempts = 3, nextAttemptAt = ? WHERE id = ?').run('2026-09-14T08:05:00.000Z', stuck);
  const { calls, drainer, liveTimers } = harness(db);

  await drainer.drain();

  assert.deepEqual(calls.map((r) => r.path), ['/svc/v1/stays/12']);
  assert.deepEqual(pending(db).map((r) => r.reservationId), [11, 11]);
  assert.equal(liveTimers()[0].delay, 5 * 60e3);
});

test('a refusal (422) closes the row with its reason and does not block the next push', async () => {
  const db = makeDb();
  portierSync.pushStay(db, 11);
  portierSync.pushStay(db, 11);
  const { calls, drainer } = harness(db, {
    answer: (_, n) => (n === 1
      ? { status: 422, data: { field: 'endsAt', reason: 'window_too_long' } }
      : { status: 200, data: { result: 'applied' } }),
  });

  await drainer.drain();

  assert.equal(calls.length, 2);
  assert.equal(pending(db).length, 0);
  const [refused, applied] = db.prepare('SELECT lastError, sentAt FROM portier_outbox ORDER BY id').all();
  assert.equal(refused.lastError, 'refused 422 endsAt window_too_long');
  assert.equal(applied.lastError, '');
  assert.equal(portierSync.reservationPushStatus(db, 11).refusal, null, 'the latest push was applied');
});

test('the logo is pushed with its bytes in standard base64 and its type', async () => {
  const db = makeDb();
  portierSync.pushBranding(db, { now: new Date(T0) });
  const { calls, drainer } = harness(db);
  await drainer.drain();
  assert.deepEqual(calls[0], {
    method: 'PUT',
    path: '/svc/v1/branding',
    body: { name: 'Domaine Solio', logo: Buffer.from('PNGBYTES').toString('base64'), mime: 'image/png', updatedAt: '2026-09-14T08:00:00.000Z' },
  });
});

test('a push failing for more than an hour becomes visible, for its reservation and for the page', () => {
  const db = makeDb();
  const id = portierSync.pushStay(db, 11, { now: new Date(T0) });
  const at = (ms) => ({ now: new Date(T0 + ms) });

  assert.equal(portierSync.reservationPushStatus(db, 11, at(2 * 3600e3)).failingSince, null, 'never attempted is not failing');
  db.prepare('UPDATE portier_outbox SET attempts = 1, nextAttemptAt = ? WHERE id = ?').run(new Date(T0 + 30e3).toISOString(), id);
  assert.equal(portierSync.reservationPushStatus(db, 11, at(59 * 60e3)).failingSince, null, 'under an hour');
  assert.equal(portierSync.reservationPushStatus(db, 11, at(61 * 60e3)).failingSince, '2026-09-14T08:00:00.000Z');
  assert.deepEqual(portierSync.failingSummary(db, at(61 * 60e3)), { reservations: 1, since: '2026-09-14T08:00:00.000Z' });
  assert.equal(portierSync.reservationPushStatus(db, 12, at(61 * 60e3)).failingSince, null);
});
