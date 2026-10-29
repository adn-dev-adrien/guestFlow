// specs/ical-import-hardening.md rule 17 (audit 2026-10-28, F9) — an event with an impossible day or an absurd
// range never reaches the sync engine.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseIcsEvents, parseIcalDate } = require('../utils/icalParser');

const NOW = new Date('2026-10-29T10:00:00Z');
const ics = (...events) => ['BEGIN:VCALENDAR', ...events.flatMap(([uid, start, end, summary = 'Jean Test']) => [
  'BEGIN:VEVENT', `UID:${uid}`, `DTSTART;VALUE=DATE:${start}`, ...(end ? [`DTEND;VALUE=DATE:${end}`] : []), `SUMMARY:${summary}`, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const parse = (...events) => parseIcsEvents(ics(...events), { now: NOW }).map((e) => [e.uid, e.startDate, e.endDate]);

test('rule 17: a day that does not exist is no date', () => {
  for (const raw of ['20270231', '20271399', '20270100', '20260230T100000Z', '2027-02-31']) assert.equal(parseIcalDate(raw, true), '', raw);
  assert.equal(parseIcalDate('20280229', true), '2028-02-29');
  assert.deepEqual(parse(['a', '20270231', '20270233'], ['c', '20271399', '20271400']), []);
});

test('rule 17: an event whose end is impossible is dropped, not turned into a one-night stay', () => {
  assert.deepEqual(parse(['a', '20270110', '20270233']), []);
});

test('rule 17: an absurd range is dropped', () => {
  assert.deepEqual(parse(['b', '20270101', '99991231']), []);
  assert.deepEqual(parse(['b', '20270101', '20290101']), []);
  assert.deepEqual(parse(['b', '20300101', '20300105']), []);
});

test('rule 17: ordinary stays, a departure not after the arrival (one night) and a missing end are kept', () => {
  assert.deepEqual(parse(['ok', '20270110', '20270114'], ['same', '20270201', '20270201'], ['noend', '20270301']), [
    ['ok', '2027-01-10', '2027-01-14'], ['same', '2027-02-01', '2027-02-02'], ['noend', '2027-03-01', '2027-03-02'],
  ]);
  assert.deepEqual(parse(['past', '20250110', '20250114']), [['past', '2025-01-10', '2025-01-14']]);
  assert.deepEqual(parse(['year', '20270101', '20271231']).length, 1);
});
