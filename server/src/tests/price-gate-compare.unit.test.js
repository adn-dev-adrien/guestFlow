// specs/pricing-components.md §3 rule 68 — `helpers/priceGateCompare.js`: exact (`Object.is`), every difference returned, the
// allowlist absorbs exactly one field of one stay with exactly its old and corrected values.
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareFigures, allowlistProblems } = require('./helpers/priceGateCompare');

const entry = (over = {}) => ({
  reservationId: 7, field: 'total.final', old: 1000, corrected: 1010, reason: 'card order not netted', rule: 'rule 32', defect: 'review e M5',
  approvedBy: 'Adrien', approvedAt: 'when', ...over,
});

test('rule 68: identical figure sets have no difference', () => {
  const figures = { 7: { 'total.final': 1000, nights: 2, kind: 'reservation' } };
  assert.deepEqual(compareFigures(figures, structuredClone(figures)), { differences: [], allowed: [], unusedEntries: [] });
});

test('rule 68: one cent is a difference, and every difference is returned, not the first', () => {
  const expected = { 7: { a: 100, b: 200, c: 'x' }, 8: { a: 5 } };
  const actual = { 7: { a: 101, b: 200, c: 'y' }, 8: { a: 4 } };
  const { differences } = compareFigures(expected, actual);
  assert.deepEqual(differences, [
    { reservationId: 7, field: 'a', expected: 100, actual: 101 },
    { reservationId: 7, field: 'c', expected: 'x', actual: 'y' },
    { reservationId: 8, field: 'a', expected: 5, actual: 4 },
  ]);
});

test('rule 68: no tolerance — 0 and null, true and 1, 100 and "100" all differ', () => {
  const { differences } = compareFigures({ 1: { a: 0, b: true, c: 100 } }, { 1: { a: null, b: 1, c: '100' } });
  assert.deepEqual(differences.map((d) => d.field), ['a', 'b', 'c']);
});

test('rule 68: a figure or a stay present on one side only is a difference', () => {
  const { differences } = compareFigures({ 1: { a: 1, gone: 2 }, 2: { a: 1 } }, { 1: { a: 1, added: 3 }, 3: { a: 1 } });
  const named = differences.map((d) => `${d.reservationId}:${d.field}`);
  assert.deepEqual(named, ['1:added', '1:gone', '2:a', '2:<stay>', '3:a', '3:<stay>']);
  assert.deepEqual(differences.find((d) => d.field === 'gone'), { reservationId: 1, field: 'gone', expected: 2, actual: undefined });
});

test('rule 68: an allowlist entry absorbs exactly its stay, field, old and corrected value', () => {
  const expected = { 7: { 'total.final': 1000, nights: 2 } };
  const actual = { 7: { 'total.final': 1010, nights: 2 } };
  const result = compareFigures(expected, actual, [entry()]);
  assert.deepEqual(result.differences, []);
  assert.equal(result.allowed.length, 1);
  assert.deepEqual(result.unusedEntries, []);
});

test('rule 68: any other value, field, or stay still fails despite an entry', () => {
  const expected = { 7: { 'total.final': 1000, nights: 2 }, 8: { 'total.final': 1000 } };
  const wrongValue = { 7: { 'total.final': 1011, nights: 2 }, 8: { 'total.final': 1000 } };
  assert.equal(compareFigures(expected, wrongValue, [entry()]).differences.length, 1, 'corrected value is different');
  const otherStay = { 7: { 'total.final': 1000, nights: 2 }, 8: { 'total.final': 1010 } };
  assert.equal(compareFigures(expected, otherStay, [entry()]).differences.length, 1, 'the entry names stay 7');
  const otherField = { 7: { 'total.final': 1000, nights: 3 }, 8: { 'total.final': 1000 } };
  assert.equal(compareFigures(expected, otherField, [entry({ field: 'total.final' })]).differences.length, 1);
  const wrongOld = { 7: { 'total.final': 999 } };
  assert.equal(compareFigures({ 7: { 'total.final': 998 } }, wrongOld, [entry({ old: 1000, corrected: 999 })]).differences.length, 1, 'old differs');
});

test('rule 68: an entry covers one difference, not a wildcard, and a stale entry is reported', () => {
  const expected = { 7: { a: 1 }, 8: { a: 1 } };
  const actual = { 7: { a: 2 }, 8: { a: 2 } };
  const result = compareFigures(expected, actual, [entry({ field: 'a', old: 1, corrected: 2 }), entry({ reservationId: 9, field: 'a', old: 1, corrected: 2 })]);
  assert.deepEqual(result.differences.map((d) => d.reservationId), [8]);
  assert.deepEqual(result.unusedEntries.map((e) => e.reservationId), [9]);
});

test('rule 68: an incomplete allowlist entry is refused before any comparison', () => {
  assert.deepEqual(allowlistProblems([]), []);
  assert.deepEqual(allowlistProblems([entry()]), []);
  assert.ok(allowlistProblems([entry({ reason: '' })]).some((p) => p.includes('reason')));
  assert.ok(allowlistProblems([{ ...entry(), defect: undefined }]).some((p) => p.includes('defect')));
  assert.ok(allowlistProblems([entry({ old: 5, corrected: 5 })]).some((p) => p.includes('equal')));
  assert.ok(allowlistProblems('nope').length > 0);
  assert.throws(() => compareFigures({}, {}, [entry({ approvedBy: ' ' })]), /allowlist is invalid/);
});

test('rule 68: no rounding slack — 12.345 and 12.35, 0.3 and 0.1 + 0.2, 0 and -0 are different figures, NaN is NaN', () => {
  const { differences } = compareFigures({ 1: { a: 12.345, b: 0.3, c: 0, d: Number.NaN, e: 1.005 } }, { 1: { a: 12.35, b: 0.1 + 0.2, c: -0, d: Number.NaN, e: 1.005 } });
  assert.deepEqual(differences.map((d) => d.field), ['a', 'b', 'c']);
});

test('rule 68: an entry with removed: true approves a figure that disappeared, never one that became null', () => {
  const entry = { reservationId: 1, field: 'a', old: 5, corrected: null, removed: true, reason: 'r', rule: 'r', defect: 'd', approvedBy: 'Adrien', approvedAt: '2026-11-12' };
  assert.deepEqual(compareFigures({ 1: { a: 5 } }, { 1: {} }, [entry]).differences, []);
  assert.deepEqual(compareFigures({ 1: { a: 5 } }, { 1: { a: null } }, [entry]).differences.map((d) => d.field), ['a']);
  const plain = { ...entry, removed: undefined };
  assert.deepEqual(compareFigures({ 1: { a: 5 } }, { 1: {} }, [plain]).differences.map((d) => d.field), ['a']);
});
