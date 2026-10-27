// specs/ical-import-hardening.md rule 16 (audit 2026-10-27) — three valid feeds the parser misread:
// `BEGIN:VEVENT` followed by blanks (0 events), `DURATION` instead of `DTEND` (1 night), and a stay
// whose DESCRIPTION happens to say « non disponible » / « blocked » although its summary names a guest.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIcsEvents, isUnavailableIcalEvent } = require('../utils/icalParser');

const wrap = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
const dates = (text, opts) => parseIcsEvents(wrap(text), opts).map((e) => [e.startDate, e.endDate]);

test('BEGIN:VEVENT / END:VEVENT with trailing blanks still delimit an event', () => {
  const body = 'BEGIN:VEVENT \t\r\nUID:a\r\nDTSTART;VALUE=DATE:20270705\r\nDTEND;VALUE=DATE:20270710\r\nSUMMARY:Jean Dupont\r\nEND:VEVENT  ';
  assert.deepEqual(dates(body), [['2027-07-05', '2027-07-10']]);
});

test('DURATION without DTEND gives the departure', () => {
  const ev = (start, duration) => `BEGIN:VEVENT\r\nUID:${duration}\r\nDTSTART${start}\r\nDURATION:${duration}\r\nSUMMARY:Jean Dupont\r\nEND:VEVENT`;
  assert.deepEqual(dates(ev(';VALUE=DATE:20270705', 'P5D')), [['2027-07-05', '2027-07-10']]);
  assert.deepEqual(dates(ev(';VALUE=DATE:20270705', 'P1W')), [['2027-07-05', '2027-07-12']]);
  // A timed arrival at 16:00 plus 4 days 18 hours leaves on the 5th morning.
  assert.deepEqual(dates(ev(':20270705T160000', 'P4DT18H')), [['2027-07-05', '2027-07-10']]);
  // DTEND still wins when both are present; an unreadable duration falls back to one night.
  const both = 'BEGIN:VEVENT\r\nUID:z\r\nDTSTART;VALUE=DATE:20270705\r\nDTEND;VALUE=DATE:20270707\r\nDURATION:P5D\r\nSUMMARY:X Y\r\nEND:VEVENT';
  assert.deepEqual(dates(both), [['2027-07-05', '2027-07-07']]);
  assert.deepEqual(dates(ev(';VALUE=DATE:20270705', 'garbage')), [['2027-07-05', '2027-07-06']]);
});

test('a description saying « non disponible » does not drop a stay that names a guest', () => {
  const body = 'BEGIN:VEVENT\r\nUID:e\r\nDTSTART;VALUE=DATE:20270705\r\nDTEND;VALUE=DATE:20270710\r\nDESCRIPTION:Statut: non disponible pour le ménage\r\nSUMMARY:Jean Dupont\r\nEND:VEVENT';
  assert.deepEqual(dates(body), [['2027-07-05', '2027-07-10']]);
  assert.equal(isUnavailableIcalEvent('Jean Dupont', 'Room blocked for cleaning'), false);
});

test('host blocks are still dropped: by their summary, or by their description when the summary names nobody', () => {
  assert.equal(isUnavailableIcalEvent('Airbnb (Not available)', ''), true);
  assert.equal(isUnavailableIcalEvent('Blocked', ''), true);
  assert.equal(isUnavailableIcalEvent('', 'Not available'), true);
  assert.equal(isUnavailableIcalEvent('Reserved', 'blocked'), true);
  assert.equal(isUnavailableIcalEvent('Reserved', 'Reservation URL: https://x'), false);
  // Booking's feed keeps them (specs/lodgify-decommission.md §3 rule 5).
  const closed = 'BEGIN:VEVENT\r\nUID:b\r\nDTSTART;VALUE=DATE:20270705\r\nDTEND;VALUE=DATE:20270710\r\nSUMMARY:CLOSED - Not available\r\nEND:VEVENT';
  assert.deepEqual(dates(closed), []);
  assert.deepEqual(dates(closed, { keepUnavailable: true }), [['2027-07-05', '2027-07-10']]);
});
