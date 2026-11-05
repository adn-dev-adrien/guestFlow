/**
 * specs/report-grammar.md §3 rules 8, 10 and 12 — the pure helpers behind the report charts: end
 * labels never overlap, fewer ticks on a phone, the CSV a spreadsheet pastes into columns.
 */
import { lastValueIndex, layoutEndLabels, tickInterval, rowsFromSeries, toCsv } from '../reportChart';

test('rule 8 — the last point of a series skips trailing gaps; none at all is -1', () => {
  expect(lastValueIndex([1, 2, null, null])).toBe(1);
  expect(lastValueIndex([null, null])).toBe(-1);
});

test('rule 8 — end labels are pushed apart by at least the gap, top to bottom', () => {
  const out = layoutEndLabels([{ key: 'b', y: 102 }, { key: 'a', y: 100 }, { key: 'c', y: 50 }], 14, 4);
  expect(out.map((e) => e.key)).toEqual(['c', 'a', 'b']);
  expect(out.map((e) => e.labelY)).toEqual([54, 104, 118]);
});

test('rule 12 — about 7 ticks on a wide screen, about 4 on a phone', () => {
  expect(tickInterval(12, false)).toBe(1);
  expect(tickInterval(12, true)).toBe(2);
  expect(tickInterval(31, false)).toBe(4);
  expect(tickInterval(31, true)).toBe(7);
  expect(tickInterval(3, true)).toBe(0);
});

test('rule 8 — rows keep a missing value as null (a gap, never a 0)', () => {
  expect(rowsFromSeries([{ key: 'm1', label: 'oct.' }, { key: 'm2', label: 'nov.' }], [{ key: 'a', values: [5, null] }]))
    .toEqual([{ key: 'm1', label: 'oct.', a: 5 }, { key: 'm2', label: 'nov.', a: null }]);
});

test('rule 10 — CSV: semicolons, decimal comma, raw numbers, empty cell for a gap, quoted text when needed', () => {
  expect(toCsv(['Période', 'Montant'], [['oct.', 1234.5], ['nov.', null], ['a;b "c"', 0]]))
    .toBe('Période;Montant\noct.;1234,5\nnov.;\n"a;b ""c""";0');
});
