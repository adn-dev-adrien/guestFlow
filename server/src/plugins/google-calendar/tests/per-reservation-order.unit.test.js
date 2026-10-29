// specs/google-calendar-oauth-rework.md rule 26 (audit R4) — pushes and deletes of ONE reservation run in the order
// they were scheduled. Without it a push in flight (update answered 404, insert not sent yet) lets the
// delete of a cancellation answer « absent », then creates the event of a cancelled stay.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const { create } = require('../sync');

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const notFound = () => Object.assign(new Error('Not Found'), { response: { status: 404 } });

// A calendar with a real event store and a slow network: every call takes `latency` ms.
function slowCalendar(latency = 15) {
  const store = new Set();
  const log = [];
  const call = async (name, fn) => { log.push(`${name}:start`); await tick(latency); try { return fn(); } finally { log.push(`${name}:end`); } };
  return {
    store,
    log,
    events: {
      update: ({ eventId }) => call('update', () => { if (!store.has(eventId)) throw notFound(); return {}; }),
      insert: ({ requestBody }) => call('insert', () => { store.add(requestBody.id); return {}; }),
      delete: ({ eventId }) => call('delete', () => { if (!store.has(eventId)) throw notFound(); store.delete(eventId); return {}; }),
    },
  };
}

function engineFor(calendar, { cancelled = new Set() } = {}) {
  const stay = (id) => ({
    id, propertyId: 1, propertyName: 'Villa', clientLastName: 'Doe', clientFirstName: 'Jane',
    startDate: '2026-06-01', endDate: '2026-06-03', checkInTime: '15:00', checkOutTime: '10:00',
    adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 1, babyBeds: 0, options: [],
  });
  return create({
    settings: {
      googleConnected: () => true,
      googleCalendarSelection: () => ({ calendarId: 'cal-1', summary: 'Agenda' }),
      recordGoogleSyncResult: () => {},
    },
    model: { getReservationForSync: (id) => (cancelled.has(Number(id)) ? null : stay(Number(id))), listReservationsForSync: () => [] },
    getCalendar: () => calendar,
    log: () => {},
  });
}

const settle = async (calendar) => { for (let i = 0; i < 20; i += 1) await tick(20); return calendar; };

test('a delete scheduled while a push is in flight runs after it and leaves no event', async () => {
  const calendar = slowCalendar();
  const cancelled = new Set();
  const engine = engineFor(calendar, { cancelled });
  engine.schedulePush(7);
  await tick(4);
  cancelled.add(7);
  engine.scheduleDelete(7);
  await settle(calendar);
  assert.equal(calendar.store.size, 0, JSON.stringify(calendar.log));
});

test('pushes and deletes of one reservation never overlap', async () => {
  const calendar = slowCalendar();
  const engine = engineFor(calendar);
  engine.schedulePush(7);
  engine.scheduleDelete(7);
  engine.schedulePush(7);
  await settle(calendar);
  let open = 0;
  for (const line of calendar.log) {
    open += line.endsWith(':start') ? 1 : -1;
    assert.ok(open <= 1, `overlap in ${JSON.stringify(calendar.log)}`);
  }
  assert.equal(calendar.store.size, 1, 'the last scheduled push wins');
});

test('different reservations still run in parallel', async () => {
  const calendar = slowCalendar();
  const engine = engineFor(calendar);
  engine.schedulePush(1);
  engine.schedulePush(2);
  await tick(25);
  assert.equal(calendar.log.filter((l) => l === 'update:start').length, 2);
  await settle(calendar);
});

test('a failing operation does not block the next one of the same reservation', async () => {
  const calendar = slowCalendar(2);
  let fail = true;
  const realUpdate = calendar.events.update;
  calendar.events.update = (args) => { if (fail) { fail = false; return Promise.reject(Object.assign(new Error('boom'), { response: { status: 500 } })); } return realUpdate(args); };
  const engine = engineFor(calendar);
  engine.schedulePush(7);
  engine.schedulePush(7);
  await settle(calendar);
  assert.equal(calendar.store.size, 1);
});

test('rule 27: slow calls, each under its own bound, never let a delete slip between update and insert', async () => {
  // Scaled from 20 s: update 25 ms + insert 28 ms are each fine, together longer than any whole-push bound.
  const calendar = slowCalendar(0);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const { update, insert, delete: del } = calendar.events;
  calendar.events.update = async (a) => { await wait(25); return update(a); };
  calendar.events.insert = async (a) => { await wait(28); return insert(a); };
  calendar.events.delete = async (a) => { await wait(2); return del(a); };
  const cancelled = new Set();
  const engine = engineFor(calendar, { cancelled });
  engine.schedulePush(9);
  await tick(5);
  cancelled.add(9);
  engine.scheduleDelete(9);
  await tick(200);
  assert.equal(calendar.store.size, 0, JSON.stringify(calendar.log));
});

test('rule 27: a call aborted at its HTTP bound stops the push before the insert, and the queue goes on', async () => {
  const calendar = slowCalendar(2);
  const timedOut = Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ETIMEDOUT' });
  const realUpdate = calendar.events.update;
  let first = true;
  calendar.events.update = (args) => { if (first) { first = false; return Promise.reject(timedOut); } return realUpdate(args); };
  const logged = [];
  const engine = create({
    settings: { googleConnected: () => true, googleCalendarSelection: () => ({ calendarId: 'cal-1' }), recordGoogleSyncResult: () => {} },
    model: { getReservationForSync: (id) => ({ id, propertyId: 1, propertyName: 'V', clientLastName: 'D', clientFirstName: 'J', startDate: '2026-06-01', endDate: '2026-06-03', checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 1, babyBeds: 0, options: [] }) },
    getCalendar: () => calendar,
    log: (...a) => logged.push(a.join(' ')),
  });
  engine.schedulePush(7);
  engine.schedulePush(7);
  await settle(calendar);
  assert.equal(calendar.log.filter((l) => l === 'insert:start').length, 1, 'the aborted push sent no insert');
  assert.equal(calendar.store.size, 1, 'the next queued push ran');
  assert.ok(logged.some((l) => /schedulePush/.test(l)), logged.join('|'));
});

test('rule 27: the HTTP bound is 20 s on the calendar client and the token transporter', () => {
  const { REQUEST_TIMEOUT_MS } = require('../oauthClient');
  assert.equal(REQUEST_TIMEOUT_MS, 20000);
});
