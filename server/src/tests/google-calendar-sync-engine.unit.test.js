const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const googleCalendarSync = require('../utils/googleCalendarSync');
const { buildGoogleEventPayload, getGoogleEventIdForReservation } = require('../utils/googleCalendarEvents');

const { create: createGoogleCalendarSync, INVALID_GRANT_DETAIL, UNREADABLE_TOKEN_DETAIL } = googleCalendarSync;

function reservation(id, over = {}) {
  return {
    id,
    propertyId: 1,
    propertyName: 'Villa',
    clientLastName: 'Doe',
    clientFirstName: 'Jane',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 0,
    teens: 0,
    babies: 0,
    singleBeds: 0,
    doubleBeds: 1,
    babyBeds: 0,
    options: [],
    ...over,
  };
}

// A remote event that exactly mirrors what we would push for `r` (offset echo included).
function remoteEcho(r) {
  const p = buildGoogleEventPayload(r, r.options);
  return {
    id: getGoogleEventIdForReservation(r.id),
    summary: p.summary,
    description: p.description,
    colorId: p.colorId,
    status: 'confirmed',
    start: { dateTime: `${p.start.dateTime}+02:00` },
    end: { dateTime: `${p.end.dateTime}+02:00` },
    extendedProperties: { private: { guestflowSource: 'guestflow', guestflowReservationId: String(r.id) } },
  };
}

function fakeSettings({ active = true } = {}) {
  const records = [];
  return {
    records,
    googleConnected: () => active,
    googleCalendarSelection: () => (active ? { calendarId: 'cal-1', summary: 'Agenda' } : { calendarId: '', summary: '' }),
    recordGoogleSyncResult: (r) => records.push(r),
  };
}

function fakeCalendar({ pages = [[]], updateError = null, updateErrorFor = new Set() } = {}) {
  const calls = { list: [], update: [], insert: [], delete: [] };
  let page = 0;
  return {
    calls,
    events: {
      list: async (args) => {
        calls.list.push(args);
        const items = pages[page] || [];
        page += 1;
        return { data: { items, nextPageToken: page < pages.length ? `p${page}` : undefined } };
      },
      update: async (args) => {
        calls.update.push(args);
        if (updateError && (updateErrorFor.size === 0 || updateErrorFor.has(args.eventId))) throw updateError;
        return {};
      },
      insert: async (args) => { calls.insert.push(args); return {}; },
      delete: async (args) => { calls.delete.push(args); return {}; },
    },
  };
}

function makeEngine({ settings, calendar, reservations = [], single = null }) {
  return createGoogleCalendarSync({
    settings,
    model: {
      listReservationsForSync: () => reservations,
      getReservationForSync: (id) => (single && Number(single.id) === Number(id) ? single : null),
    },
    getCalendar: () => calendar,
    log: () => {},
  });
}

// --- inactivity gate ---

test('inactive (not connected / no calendar) → every entrypoint is a silent no-op, zero API calls', async () => {
  const settings = fakeSettings({ active: false });
  const calendar = fakeCalendar();
  const engine = makeEngine({ settings, calendar, reservations: [reservation(1)], single: reservation(1) });

  assert.equal(await engine.pushReservation(1), null);
  assert.equal(await engine.deleteReservationEvent(1), null);
  const out = await engine.reconcile();
  assert.equal(out.inactive, true);
  assert.equal(calendar.calls.list.length + calendar.calls.update.length + calendar.calls.insert.length + calendar.calls.delete.length, 0);
  assert.equal(settings.records.length, 0, 'no sync result recorded while inactive');
});

// --- targeted push / delete ---

test('pushReservation: pushes an existing reservation, no-op for devis/absent ids', async () => {
  const settings = fakeSettings();
  const calendar = fakeCalendar();
  const engine = makeEngine({ settings, calendar, single: reservation(7) });

  assert.equal(await engine.pushReservation(7), 'updated');
  assert.equal(calendar.calls.update[0].calendarId, 'cal-1');
  assert.equal(calendar.calls.update[0].eventId, 'gfres7');

  assert.equal(await engine.pushReservation(999), null, 'unknown id → no-op');
  assert.equal(calendar.calls.update.length, 1);
});

test('deleteReservationEvent: deletes by computed event id on the selected calendar', async () => {
  const settings = fakeSettings();
  const calendar = fakeCalendar();
  const engine = makeEngine({ settings, calendar });
  assert.equal(await engine.deleteReservationEvent(7), 'deleted');
  assert.deepEqual(calendar.calls.delete[0], { calendarId: 'cal-1', eventId: 'gfres7' });
});

// --- reconcile ---

test('reconcile: skips unchanged, pushes changed/missing, purges orphans, records ok', async () => {
  const unchanged = reservation(1);
  const changed = reservation(2, { clientLastName: 'Nouveau' });
  const missing = reservation(3);

  const staleRemoteForChanged = { ...remoteEcho(reservation(2)), summary: 'Villa - Ancien Nom' };
  const orphan = { ...remoteEcho(reservation(99)), id: 'gfres99' };

  const settings = fakeSettings();
  const calendar = fakeCalendar({ pages: [[remoteEcho(unchanged), staleRemoteForChanged, orphan]] });
  const engine = makeEngine({ settings, calendar, reservations: [unchanged, changed, missing] });

  const out = await engine.reconcile();
  assert.deepEqual(out, { ok: true, pushed: 2, deleted: 1, skipped: 1, errors: 0, detail: '2 envoyée(s), 1 supprimée(s), 1 inchangée(s)' });
  assert.equal(calendar.calls.list[0].privateExtendedProperty, 'guestflowSource=guestflow');
  assert.deepEqual(calendar.calls.update.map((c) => c.eventId).sort(), ['gfres2', 'gfres3']);
  assert.deepEqual(calendar.calls.delete.map((c) => c.eventId), ['gfres99']);
  assert.equal(settings.records.length, 1);
  assert.equal(settings.records[0].ok, true);
  assert.match(settings.records[0].detail, /2 envoyée\(s\), 1 supprimée\(s\), 1 inchangée\(s\)/);
});

test('reconcile: a guestflow-stamped event under a non-canonical id is purged as a stray copy', async () => {
  const r1 = reservation(1);
  // Same reservation id, but the event lives under a Google-assigned id (e.g. duplicated in
  // the Google UI, which copies private extendedProperties).
  const stray = { ...remoteEcho(r1), id: 'abc123xyz' };
  const settings = fakeSettings();
  const calendar = fakeCalendar({ pages: [[remoteEcho(r1), stray]] });
  const engine = makeEngine({ settings, calendar, reservations: [r1] });

  const out = await engine.reconcile();
  assert.equal(out.skipped, 1, 'canonical event unchanged');
  assert.equal(out.deleted, 1, 'stray copy purged');
  assert.deepEqual(calendar.calls.delete.map((c) => c.eventId), ['abc123xyz']);
});

test('reconcile: unreadable stored token (decrypt failure) records a red status instead of freezing', async () => {
  const settings = fakeSettings();
  const engine = createGoogleCalendarSync({
    settings,
    model: { listReservationsForSync: () => [], getReservationForSync: () => null },
    getCalendar: () => null,
    log: () => {},
  });
  const out = await engine.reconcile();
  assert.equal(out.ok, false);
  assert.equal(out.detail, UNREADABLE_TOKEN_DETAIL);
  assert.equal(settings.records.length, 1);
  assert.equal(settings.records[0].ok, false);
  assert.equal(settings.records[0].detail, UNREADABLE_TOKEN_DETAIL);
});

test('reconcile: paginates the remote listing', async () => {
  const r1 = reservation(1);
  const r2 = reservation(2);
  const settings = fakeSettings();
  const calendar = fakeCalendar({ pages: [[remoteEcho(r1)], [remoteEcho(r2)]] });
  const engine = makeEngine({ settings, calendar, reservations: [r1, r2] });

  const out = await engine.reconcile();
  assert.equal(calendar.calls.list.length, 2);
  assert.equal(calendar.calls.list[1].pageToken, 'p1');
  assert.deepEqual(out, { ok: true, pushed: 0, deleted: 0, skipped: 2, errors: 0, detail: '0 envoyée(s), 0 supprimée(s), 2 inchangée(s)' });
});

test('reconcile: per-item fault isolation — one failing reservation does not stop the run', async () => {
  const failing = reservation(1);
  const fine = reservation(2);
  const settings = fakeSettings();
  const calendar = fakeCalendar({
    pages: [[]],
    updateError: { response: { status: 500 } },
    updateErrorFor: new Set(['gfres1']),
  });
  const engine = makeEngine({ settings, calendar, reservations: [failing, fine] });

  const out = await engine.reconcile();
  // gfres1: update 500 → counted as error; gfres2: update 404? no — update succeeds.
  assert.equal(out.ok, false);
  assert.equal(out.errors, 1);
  assert.equal(out.pushed, 1);
  assert.equal(settings.records[0].ok, false);
  assert.match(settings.records[0].detail, /1 erreur\(s\)/);
});

test('reconcile: invalid_grant aborts the run and records the reconnect message', async () => {
  const settings = fakeSettings();
  const calendar = fakeCalendar({ pages: [[]], updateError: { response: { data: { error: 'invalid_grant' } } } });
  const engine = makeEngine({ settings, calendar, reservations: [reservation(1), reservation(2)] });

  const out = await engine.reconcile();
  assert.equal(out.ok, false);
  assert.equal(out.detail, INVALID_GRANT_DETAIL);
  assert.equal(calendar.calls.update.length + calendar.calls.insert.length, 1, 'aborted after the first failure');
  assert.equal(settings.records[0].ok, false);
  assert.equal(settings.records[0].detail, INVALID_GRANT_DETAIL);
});

test('runReconcileGuarded: overlapping run is skipped (alreadyRunning)', async () => {
  const settings = fakeSettings();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calendar = {
    events: {
      list: async () => { await gate; return { data: { items: [] } }; },
      update: async () => ({}),
      insert: async () => ({}),
      delete: async () => ({}),
    },
  };
  const engine = makeEngine({ settings, calendar, reservations: [] });

  const first = engine.runReconcileGuarded();
  const second = await engine.runReconcileGuarded();
  assert.equal(second.alreadyRunning, true);
  release();
  const out = await first;
  assert.equal(out.ok, true);
});
