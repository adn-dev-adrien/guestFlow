const test = require('node:test');
const assert = require('node:assert/strict');

const googleCalendarRoute = require('../routes/googleCalendar');

const {
  buildEventTitle,
  buildEventDescription,
  buildGoogleEventPayload,
  getGoogleEventIdForReservation,
  formatOptionQuantity,
} = googleCalendarRoute.__test;

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

test('buildGoogleEventPayload creates event with start and end times', () => {
  const payload = buildGoogleEventPayload(
    {
      id: 42,
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
  assert.equal(payload.extendedProperties.private.guestflowSource, 'guestflow');
  assert.equal(payload.extendedProperties.private.guestflowReservationId, '42');
});

test('getGoogleEventIdForReservation returns deterministic id', () => {
  assert.equal(getGoogleEventIdForReservation(15), 'guestflow-r15');
});

test('formatOptionQuantity keeps integers and trims decimals', () => {
  assert.equal(formatOptionQuantity(2), '2');
  assert.equal(formatOptionQuantity(1.5), '1.50');
  assert.equal(formatOptionQuantity(3.0), '3');
});
