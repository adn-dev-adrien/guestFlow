const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEventTitle,
  buildEventDescription,
  buildGoogleEventPayload,
  getGoogleEventIdForReservation,
  getColorIdForProperty,
  formatOptionQuantity,
  upsertReservationEvent,
  deleteReservationEventById,
  eventDiffers,
} = require('../utils/googleCalendarEvents');

test('buildEventTitle formats property and client names', () => {
  const title = buildEventTitle({
    propertyName: 'Villa Bleue',
    clientLastName: 'Dupont',
    clientFirstName: 'Alice',
  });

  assert.equal(title, 'Villa Bleue - Dupont Alice');
});

test('buildEventDescription includes people, beds and options', () => {
  const description = buildEventDescription(
    {
      adults: 2,
      children: 1,
      teens: 1,
      babies: 1,
      doubleBeds: 1,
      singleBeds: 2,
      babyBeds: 1,
    },
    [
      { title: 'Menage', quantity: 1 },
      { title: 'Kit bebe', quantity: 2 },
    ],
  );

  assert.match(description, /Voyageurs/);
  assert.match(description, /Total: 5/);
  assert.match(description, /Doubles: 1/);
  assert.match(description, /Simples: 2/);
  assert.match(description, /Bebe: 1/);
  assert.match(description, /- Menage x1/);
  assert.match(description, /- Kit bebe x2/);
});

test('buildGoogleEventPayload creates event with times, color and confirmed status', () => {
  const payload = buildGoogleEventPayload(
    {
      id: 42,
      propertyId: 3,
      propertyName: 'Loft Centre',
      clientLastName: 'Martin',
      clientFirstName: 'Leo',
      startDate: '2026-06-01',
      endDate: '2026-06-05',
      checkInTime: '15:00',
      checkOutTime: '10:00',
      adults: 2,
      children: 0,
      teens: 0,
      babies: 0,
      singleBeds: 0,
      doubleBeds: 1,
      babyBeds: 0,
    },
    [],
  );

  assert.equal(payload.summary, 'Loft Centre - Martin Leo');
  assert.equal(payload.start.dateTime, '2026-06-01T15:00:00');
  assert.equal(payload.end.dateTime, '2026-06-05T10:00:00');
  assert.equal(payload.start.timeZone, 'Europe/Paris');
  assert.equal(payload.end.timeZone, 'Europe/Paris');
  assert.equal(payload.colorId, '3');
  assert.equal(payload.status, 'confirmed');
  assert.equal(payload.extendedProperties.private.guestflowSource, 'guestflow');
  assert.equal(payload.extendedProperties.private.guestflowReservationId, '42');
});

// Google event ids only allow base32hex characters (0-9, a-v), min length 5 — the old
// `guestflow-r<id>` scheme ('w', '-') was rejected by the API (spec rule 13).
test('getGoogleEventIdForReservation returns a base32hex-safe deterministic id', () => {
  assert.equal(getGoogleEventIdForReservation(15), 'gfres15');
  assert.match(getGoogleEventIdForReservation(15), /^[a-v0-9]{5,}$/);
  assert.match(getGoogleEventIdForReservation(1), /^[a-v0-9]{5,}$/);
});

test('getColorIdForProperty is deterministic over the 1-11 Google palette', () => {
  assert.equal(getColorIdForProperty(1), '1');
  assert.equal(getColorIdForProperty(11), '11');
  assert.equal(getColorIdForProperty(12), '1');
  assert.equal(getColorIdForProperty(0), '1');
  assert.equal(getColorIdForProperty(undefined), '1');
});

test('formatOptionQuantity keeps integers and trims decimals', () => {
  assert.equal(formatOptionQuantity(2), '2');
  assert.equal(formatOptionQuantity(1.5), '1.50');
  assert.equal(formatOptionQuantity(3.0), '3');
});

// --- upsert / delete against a fake calendar API ---

const RESERVATION = {
  id: 7,
  propertyId: 2,
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
};

function httpError(status) {
  return { response: { status } };
}

function makeCalendar({ updateErrors = [], insertError = null } = {}) {
  const calls = { update: [], insert: [], delete: [] };
  let updateCall = 0;
  return {
    calls,
    events: {
      update: async (args) => {
        calls.update.push(args);
        const err = updateErrors[updateCall];
        updateCall += 1;
        if (err) throw err;
        return {};
      },
      insert: async (args) => {
        calls.insert.push(args);
        if (insertError) throw insertError;
        return {};
      },
      delete: async (args) => {
        calls.delete.push(args);
        return {};
      },
    },
  };
}

test('upsertReservationEvent: update-first, 1 call in steady state', async () => {
  const calendar = makeCalendar();
  const mode = await upsertReservationEvent(calendar, 'cal-1', RESERVATION, []);
  assert.equal(mode, 'updated');
  assert.equal(calendar.calls.update.length, 1);
  assert.equal(calendar.calls.insert.length, 0);
  assert.equal(calendar.calls.update[0].eventId, 'gfres7');
});

test('upsertReservationEvent: update 404 → insert with fixed id', async () => {
  const calendar = makeCalendar({ updateErrors: [httpError(404)] });
  const mode = await upsertReservationEvent(calendar, 'cal-1', RESERVATION, []);
  assert.equal(mode, 'created');
  assert.equal(calendar.calls.insert.length, 1);
  assert.equal(calendar.calls.insert[0].requestBody.id, 'gfres7');
  assert.equal(calendar.calls.insert[0].requestBody.status, 'confirmed');
});

test('upsertReservationEvent: insert 409 (cancelled event remembered) → retry update resurrects', async () => {
  const calendar = makeCalendar({ updateErrors: [httpError(404), null], insertError: httpError(409) });
  const mode = await upsertReservationEvent(calendar, 'cal-1', RESERVATION, []);
  assert.equal(mode, 'updated');
  assert.equal(calendar.calls.update.length, 2);
  assert.equal(calendar.calls.insert.length, 1);
});

test('upsertReservationEvent: non-404 update error is rethrown', async () => {
  const calendar = makeCalendar({ updateErrors: [httpError(500)] });
  await assert.rejects(() => upsertReservationEvent(calendar, 'cal-1', RESERVATION, []));
});

test('deleteReservationEventById: deletes by computed id, swallows 404 and 410', async () => {
  const ok = makeCalendar();
  assert.equal(await deleteReservationEventById(ok, 'cal-1', 7), 'deleted');
  assert.equal(ok.calls.delete[0].eventId, 'gfres7');

  for (const status of [404, 410]) {
    const calendar = {
      events: { delete: async () => { throw httpError(status); } },
    };
    assert.equal(await deleteReservationEventById(calendar, 'cal-1', 7), 'absent');
  }

  const failing = { events: { delete: async () => { throw httpError(500); } } };
  await assert.rejects(() => deleteReservationEventById(failing, 'cal-1', 7));
});

// --- eventDiffers: instant-safe comparison (Google echoes dateTimes with a UTC offset) ---

test('eventDiffers: false when the remote echo matches (offset-normalized dateTimes)', () => {
  const desired = buildGoogleEventPayload(RESERVATION, []);
  const remote = {
    summary: desired.summary,
    description: desired.description,
    colorId: desired.colorId,
    status: 'confirmed',
    start: { dateTime: '2026-06-01T15:00:00+02:00', timeZone: 'Europe/Paris' },
    end: { dateTime: '2026-06-03T10:00:00+02:00', timeZone: 'Europe/Paris' },
  };
  assert.equal(eventDiffers(remote, desired), false);
});

test('eventDiffers: true on any visible change (summary, dates, color, status)', () => {
  const desired = buildGoogleEventPayload(RESERVATION, []);
  const base = {
    summary: desired.summary,
    description: desired.description,
    colorId: desired.colorId,
    status: 'confirmed',
    start: { dateTime: '2026-06-01T15:00:00+02:00' },
    end: { dateTime: '2026-06-03T10:00:00+02:00' },
  };
  assert.equal(eventDiffers({ ...base, summary: 'Autre - Nom' }, desired), true);
  assert.equal(eventDiffers({ ...base, start: { dateTime: '2026-06-02T15:00:00+02:00' } }, desired), true);
  assert.equal(eventDiffers({ ...base, colorId: '9' }, desired), true);
  assert.equal(eventDiffers({ ...base, status: 'cancelled' }, desired), true);
  assert.equal(eventDiffers(undefined, desired), true);
});
