const test = require('node:test');
const assert = require('node:assert/strict');

const { getFrenchPublicHolidays } = require('../utils/frenchHolidays');

test('returns the 11 French public holidays for a year, sorted ascending', () => {
  const h = getFrenchPublicHolidays(2025);
  assert.equal(h.length, 11);
  const dates = h.map((x) => x.date);
  assert.deepEqual([...dates].sort((a, b) => a.localeCompare(b)), dates); // already sorted
});

test('fixed holidays are present', () => {
  const dates = getFrenchPublicHolidays(2025).map((x) => x.date);
  for (const d of ['2025-01-01', '2025-05-01', '2025-05-08', '2025-07-14', '2025-08-15', '2025-11-01', '2025-11-11', '2025-12-25']) {
    assert.ok(dates.includes(d), `missing fixed holiday ${d}`);
  }
});

test('Easter-derived holidays — 2025 (Easter 20 Apr)', () => {
  const dates = getFrenchPublicHolidays(2025).map((x) => x.date);
  assert.ok(dates.includes('2025-04-21'), 'Lundi de Pâques');
  assert.ok(dates.includes('2025-05-29'), 'Ascension');
  assert.ok(dates.includes('2025-06-09'), 'Lundi de Pentecôte');
});

test('Easter-derived holidays — 2024 (Easter 31 Mar)', () => {
  const dates = getFrenchPublicHolidays(2024).map((x) => x.date);
  assert.ok(dates.includes('2024-04-01'), 'Lundi de Pâques');
  assert.ok(dates.includes('2024-05-09'), 'Ascension');
  assert.ok(dates.includes('2024-05-20'), 'Lundi de Pentecôte');
});

test('labels accompany every date', () => {
  for (const h of getFrenchPublicHolidays(2026)) {
    assert.match(h.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(typeof h.label === 'string' && h.label.length > 0);
  }
});
