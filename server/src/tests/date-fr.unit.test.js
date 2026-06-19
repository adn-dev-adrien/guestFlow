// French-locale date + time formatters used by the email context builder.
// See specs/email-automation.md §3 rule 5.

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatDateLong, formatTimeShort } = require('../utils/dateFr');

test('formatDateLong: regular dates render as "D MOIS YYYY"', () => {
  assert.equal(formatDateLong('2026-06-15'), '15 juin 2026');
  assert.equal(formatDateLong('2026-12-25'), '25 décembre 2026');
  assert.equal(formatDateLong('2026-01-01'), '1 janvier 2026');
  assert.equal(formatDateLong('2026-08-31'), '31 août 2026');
});

test('formatDateLong: drops a time component if present', () => {
  assert.equal(formatDateLong('2026-06-15T15:00:00Z'), '15 juin 2026');
});

test('formatDateLong: lang="en" renders English months; default stays French (specs/email-language-fr-en.md)', () => {
  assert.equal(formatDateLong('2026-06-15', 'en'), '15 June 2026');
  assert.equal(formatDateLong('2026-12-25', 'en'), '25 December 2026');
  assert.equal(formatDateLong('2026-01-01', 'en'), '1 January 2026');
  assert.equal(formatDateLong('2026-06-15'), '15 juin 2026');       // default unchanged
  assert.equal(formatDateLong('2026-06-15', 'fr'), '15 juin 2026');
});

test('formatDateLong: empty / falsy → empty string', () => {
  assert.equal(formatDateLong(''), '');
  assert.equal(formatDateLong(null), '');
  assert.equal(formatDateLong(undefined), '');
});

test('formatDateLong: malformed input → empty string (fail-quiet)', () => {
  assert.equal(formatDateLong('2026-13-01'), '');
  assert.equal(formatDateLong('2026-00-01'), '');
  assert.equal(formatDateLong('abc'), '');
  assert.equal(formatDateLong('2026-06-32'), '');
});

test('formatTimeShort: HH:mm pass-through, HH:mm:SS truncated to HH:mm', () => {
  assert.equal(formatTimeShort('15:00'), '15:00');
  assert.equal(formatTimeShort('09:30:45'), '09:30');
  assert.equal(formatTimeShort('9:5'), '');   // mm must be 2 digits
  assert.equal(formatTimeShort('9:05'),  '09:05');
});

test('formatTimeShort: malformed → empty string', () => {
  assert.equal(formatTimeShort(''), '');
  assert.equal(formatTimeShort(null), '');
  assert.equal(formatTimeShort('25:00'), '');
  assert.equal(formatTimeShort('15:99'), '');
  assert.equal(formatTimeShort('abc'), '');
});
