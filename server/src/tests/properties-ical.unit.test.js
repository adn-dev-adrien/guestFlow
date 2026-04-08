const test = require('node:test');
const assert = require('node:assert/strict');

const propertiesRoute = require('../routes/properties');

const {
  normalizePlatformKey,
  parseIcalDate,
  parseAdultsFromText,
  parseGuestName,
  parseIcsEvents,
  buildEventHash,
} = propertiesRoute.__test;

test('normalizePlatformKey sanitizes labels', () => {
  assert.equal(normalizePlatformKey(' Booking.com '), 'booking-com');
  assert.equal(normalizePlatformKey('Abritel FR'), 'abritel-fr');
});

test('parseIcalDate handles date-only and UTC date-time formats', () => {
  assert.equal(parseIcalDate('20260410', true), '2026-04-10');
  assert.equal(parseIcalDate('20260410T230000Z', false), '2026-04-10');
});

test('parseAdultsFromText extracts adults count from iCal text', () => {
  assert.equal(parseAdultsFromText('Reservation - 3 adultes', ''), 3);
  assert.equal(parseAdultsFromText('Booking', 'Guests: 2'), 2);
  assert.equal(parseAdultsFromText('No count', ''), 1);
});

test('parseGuestName returns a sane fallback and strips platform words', () => {
  const a = parseGuestName('Airbnb - Jean Dupont', '');
  assert.equal(a.firstName, 'Jean');
  assert.equal(a.lastName, 'Dupont');

  const b = parseGuestName('', '');
  assert.equal(b.firstName, 'Client');
  assert.equal(b.lastName, 'iCal');
});

test('parseIcsEvents parses VEVENT and ignores CANCELLED events', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:event-1',
    'DTSTART;VALUE=DATE:20260412',
    'DTEND;VALUE=DATE:20260415',
    'SUMMARY:Booking - Alice Martin',
    'DESCRIPTION:Adults: 2',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:event-2',
    'DTSTART;VALUE=DATE:20260420',
    'DTEND;VALUE=DATE:20260422',
    'SUMMARY:Blocked',
    'STATUS:CANCELLED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const events = parseIcsEvents(ics);
  assert.equal(events.length, 1);
  assert.equal(events[0].uid, 'event-1');
  assert.equal(events[0].startDate, '2026-04-12');
  assert.equal(events[0].endDate, '2026-04-15');
  assert.equal(events[0].adults, 2);
});

test('buildEventHash is stable for same payload and changes when event changes', () => {
  const base = {
    uid: 'abc',
    startDate: '2026-04-01',
    endDate: '2026-04-03',
    summary: 'John Doe',
    description: 'Adults:2',
    adults: 2,
  };
  const hashA = buildEventHash(base);
  const hashB = buildEventHash({ ...base });
  const hashC = buildEventHash({ ...base, endDate: '2026-04-04' });

  assert.equal(hashA, hashB);
  assert.notEqual(hashA, hashC);
});
