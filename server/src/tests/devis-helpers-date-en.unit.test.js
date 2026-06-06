// English date formatter for the bilingual devis PDF.
// See specs/devis-english-language.md §3 rule 3.

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatDateEN, formatDateFR, formatDateLocalised } = require('../utils/devisHelpers');

test('formatDateEN: regular dates render as "D MMMM YYYY" with English month names', () => {
  assert.equal(formatDateEN('2026-06-05'), '5 June 2026');
  assert.equal(formatDateEN('2026-12-25'), '25 December 2026');
  assert.equal(formatDateEN('2026-01-01'), '1 January 2026');
  assert.equal(formatDateEN('2026-10-31'), '31 October 2026');
});

test('formatDateEN: empty / falsy input → empty string', () => {
  assert.equal(formatDateEN(''), '');
  assert.equal(formatDateEN(null), '');
  assert.equal(formatDateEN(undefined), '');
});

test('formatDateEN: malformed month → empty string (fail-quiet, no junk like "5 undefined 2026")', () => {
  assert.equal(formatDateEN('2026-99-05'), '');
  assert.equal(formatDateEN('2026-0-05'), '');
  assert.equal(formatDateEN('abc'), '');
});

test('formatDateEN: malformed day → empty string', () => {
  assert.equal(formatDateEN('2026-06-0'), '');
  assert.equal(formatDateEN('2026-06-xx'), '');
});

test('formatDateFR is untouched (no regression on the existing FR path)', () => {
  assert.equal(formatDateFR('2026-06-05'), '05/06/2026');
  assert.equal(formatDateFR('2026-01-01'), '01/01/2026');
  assert.equal(formatDateFR(''), '');
});

test('formatDateLocalised routes to the right formatter', () => {
  assert.equal(formatDateLocalised('2026-06-05', 'fr'), '05/06/2026');
  assert.equal(formatDateLocalised('2026-06-05', 'en'), '5 June 2026');
  // Defaults to FR for unknown language / null / empty.
  assert.equal(formatDateLocalised('2026-06-05', null), '05/06/2026');
  assert.equal(formatDateLocalised('2026-06-05', undefined), '05/06/2026');
  assert.equal(formatDateLocalised('2026-06-05', ''), '05/06/2026');
  // Case-insensitive.
  assert.equal(formatDateLocalised('2026-06-05', 'EN'), '5 June 2026');
  assert.equal(formatDateLocalised('2026-06-05', 'Fr'), '05/06/2026');
});
