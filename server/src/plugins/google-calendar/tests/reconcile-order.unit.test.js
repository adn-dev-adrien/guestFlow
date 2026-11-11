// specs/google-calendar-oauth-rework.md rule 28 (audit R5-2) — reconcile pushes each stay through the same
// per-reservation order as the hooks, and re-reads the stay inside it: a cancellation answered while the
// reconcile walks its list must not be undone by the reconcile's stale snapshot.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const { create } = require('../sync');
const { getGoogleEventIdForReservation } = require('../events');

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const notFound = () => Object.assign(new Error('Not Found'), { response: { status: 404 } });

function slowCalendar(latency = 15) {
  const store = new Map();
  const call = async (fn) => { await tick(latency); return fn(); };
  return {
    store,
    events: {
      list: () => call(() => ({ data: { items: [...store.values()] } })),
      update: ({ eventId, requestBody }) => call(() => { if (!store.has(eventId)) throw notFound(); store.set(eventId, requestBody); return {}; }),
      insert: ({ requestBody }) => call(() => { store.set(requestBody.id, requestBody); return {}; }),
      delete: ({ eventId }) => call(() => { if (!store.has(eventId)) throw notFound(); store.delete(eventId); return {}; }),
    },
  };
}

function stay(id, startDate = '2026-06-01') {
  return {
    id, propertyId: 1, propertyName: 'Villa', clientLastName: 'Doe', clientFirstName: 'J', startDate, endDate: '2026-06-03',
    checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 1, babyBeds: 0, options: [],
  };
}

function engineFor(calendar, current) {
  return create({
    settings: { googleConnected: () => true, googleCalendarSelection: () => ({ calendarId: 'c' }), recordGoogleSyncResult: () => {} },
    model: {
      getReservationForSync: (id) => current.get(id) || null,
      listReservationsForSync: () => [...current.values()].map((r) => ({ ...r })),
    },
    getCalendar: () => calendar,
    log: () => {},
  });
}

test('rule 28: a stay cancelled while reconcile walks its list keeps no Google event', async () => {
  const calendar = slowCalendar();
  const current = new Map([[7, stay(7)], [8, stay(8)]]);
  const engine = engineFor(calendar, current);
  const run = engine.runReconcileGuarded();
  await tick(25);
  current.delete(8);
  engine.scheduleDelete(8);
  await run;
  await tick(150);
  assert.ok(!calendar.store.has(getGoogleEventIdForReservation(8)), 'event of the cancelled stay left in Google');
  assert.ok(calendar.store.has(getGoogleEventIdForReservation(7)));
});

test('rule 28: a stay whose dates changed while reconcile walks its list is pushed with the new dates', async () => {
  const calendar = slowCalendar();
  const current = new Map([[7, stay(7)], [8, stay(8)]]);
  const engine = engineFor(calendar, current);
  const run = engine.runReconcileGuarded();
  await tick(25);
  current.set(8, stay(8, '2026-07-10'));
  await run;
  const event = calendar.store.get(getGoogleEventIdForReservation(8));
  assert.ok(JSON.stringify(event).includes('2026-07-10'), 'stale dates pushed');
});

test('rule 28: reconcile still pushes every stay and counts it', async () => {
  const calendar = slowCalendar(2);
  const current = new Map([[7, stay(7)], [8, stay(8)]]);
  const engine = engineFor(calendar, current);
  const out = await engine.reconcile();
  assert.deepEqual([out.ok, out.pushed, out.errors], [true, 2, 0]);
});
