// Prestations vendues en cours de séjour — pure split helpers.
// See specs/mid-stay-extras-to-end-of-stay-complement.md §3.1-§3.2 + §3.4 rules 11-12.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extraLineKey, buildExtrasBaseline, splitMidStayExtras, splitFromStoredLines,
  mergeMidStayIntoDetail, sasDetailAmount, storedMidStayLines, MID_STAY_SOURCE,
} = require('../utils/midStayExtras');

const opt = (optionId, totalPrice, extra = {}) => ({ optionId, totalPrice, unitPrice: totalPrice, ...extra });

test('extraLineKey: one namespace per line type, custom lines keyed by normalised label', () => {
  assert.equal(extraLineKey({ optionId: 9 }), 'opt:9');
  assert.equal(extraLineKey({ resourceId: 3 }), 'res:3');
  assert.equal(extraLineKey({ isCustom: true, title: '  Linge   Manquant ' }), 'custom:linge manquant');
  assert.equal(extraLineKey({ customOptionId: 4, description: 'Ménage' }), 'custom:ménage');
  assert.equal(extraLineKey({ isCustom: true, title: '   ' }), null, 'a blank label is not a key');
  assert.equal(extraLineKey(null), null);
});

test('buildExtrasBaseline: sums per key, skips offered and zero lines', () => {
  const baseline = buildExtrasBaseline([
    opt(9, 12), opt(9, 12), // same key → aggregated
    { resourceId: 3, totalPrice: 30 },
    { isCustom: true, title: 'Ménage', totalPrice: 60 },
    { optionId: 5, totalPrice: 0, offered: 1 },
    { optionId: 6, totalPrice: 0 },
  ]);
  assert.deepEqual(baseline, { 'opt:9': 24, 'res:3': 30, 'custom:ménage': 60 });
});

test('no baseline (stay not started) → nothing is mid-stay', () => {
  const split = splitMidStayExtras([opt(9, 24)], null);
  assert.deepEqual(split, { total: 0, forced: 0, unforced: 0, byKey: {}, lines: [] });
});

test('a brand-new line is fully mid-stay, itemised with its label', () => {
  const split = splitMidStayExtras([{ optionId: 9, title: 'Petit-déjeuner', totalPrice: 24, unitPrice: 12 }], '{}');
  assert.equal(split.total, 24);
  assert.equal(split.unforced, 24);
  assert.equal(split.forced, 0);
  assert.deepEqual(split.lines, [{
    label: 'Petit-déjeuner', qty: 2, unitPrice: 12, amount: 24, source: MID_STAY_SOURCE, key: 'opt:9',
  }]);
});

test('quantity bump: only the units added during the stay move', () => {
  const split = splitMidStayExtras(
    [{ optionId: 9, title: 'Petit-déjeuner', totalPrice: 36, unitPrice: 12 }],
    JSON.stringify({ 'opt:9': 24 }),
  );
  assert.equal(split.total, 12);
  assert.deepEqual(split.lines[0], {
    label: 'Petit-déjeuner', qty: 1, unitPrice: 12, amount: 12, source: MID_STAY_SOURCE, key: 'opt:9',
  });
});

test('removing / shrinking a line brings the mid-stay part back to 0, never negative', () => {
  const shrunk = splitMidStayExtras([opt(9, 12)], JSON.stringify({ 'opt:9': 24 }));
  assert.deepEqual(shrunk.byKey, {});
  assert.equal(shrunk.total, 0);

  const removed = splitMidStayExtras([], JSON.stringify({ 'opt:9': 24 }));
  assert.equal(removed.total, 0);
  assert.deepEqual(removed.lines, []);
});

test('forced (inComplement) vs unforced shares are tracked separately', () => {
  const split = splitMidStayExtras([
    { optionId: 9, title: 'Petit-déjeuner', totalPrice: 24, unitPrice: 12, inComplement: 1 },
    { resourceId: 3, name: 'Vélo', totalPrice: 30, unitPrice: 30 },
  ], '{}');
  assert.equal(split.total, 54);
  assert.equal(split.forced, 24);
  assert.equal(split.unforced, 30);
});

test('an offered line is never billed, mid-stay or not', () => {
  const split = splitMidStayExtras([{ optionId: 9, title: 'Petit-déjeuner', totalPrice: 0, offered: 1 }], '{}');
  assert.equal(split.total, 0);
});

test('two custom lines sharing a label are aggregated on one key, on both sides', () => {
  const split = splitMidStayExtras([
    { isCustom: true, title: 'Boisson', totalPrice: 5, unitPrice: 5 },
    { isCustom: true, title: 'boisson ', totalPrice: 5, unitPrice: 5 },
  ], JSON.stringify({ 'custom:boisson': 5 }));
  assert.equal(split.total, 5, 'only the second drink is mid-stay');
  assert.equal(split.lines.length, 1);
});

test('a non-integer number of units stays a flat amount (no misleading « × »)', () => {
  const split = splitMidStayExtras(
    [{ optionId: 9, title: 'Petit-déjeuner', totalPrice: 30, unitPrice: 12 }],
    JSON.stringify({ 'opt:9': 12 }),
  );
  assert.deepEqual(split.lines[0], {
    label: 'Petit-déjeuner', qty: 1, unitPrice: 18, amount: 18, source: MID_STAY_SOURCE, key: 'opt:9',
  });
});

test('splitFromStoredLines: frozen amounts, routing re-read from the current lines', () => {
  const stored = [{ label: 'Petit-déjeuner', amount: 12, key: 'opt:9', source: MID_STAY_SOURCE }];
  const split = splitFromStoredLines(stored, [{ optionId: 9, totalPrice: 36, inComplement: 1 }]);
  assert.equal(split.total, 12, 'the collected amount is NOT re-priced from the current line');
  assert.equal(split.forced, 12);
  assert.deepEqual(split.byKey, { 'opt:9': 12 });
});

test('mergeMidStayIntoDetail: replaces the mid-stay lines, preserves the SAS ones, re-totals', () => {
  const detail = JSON.stringify([
    { label: 'Ménage de fin de séjour', amount: 60 },
    { label: 'Plomb manquant', amount: 32 },
    { label: 'Vieille prestation', amount: 99, source: MID_STAY_SOURCE },
  ]);
  const { detail: next, amount } = mergeMidStayIntoDetail(detail, [
    { label: 'Petit-déjeuner', qty: 1, unitPrice: 12, amount: 12, source: MID_STAY_SOURCE, key: 'opt:9' },
  ]);
  assert.deepEqual(next.map((l) => l.label), ['Ménage de fin de séjour', 'Plomb manquant', 'Petit-déjeuner']);
  assert.equal(amount, 104);
});

test('mergeMidStayIntoDetail: no mid-stay line left → back to the SAS-only detail', () => {
  const detail = JSON.stringify([
    { label: 'Ménage de fin de séjour', amount: 60 },
    { label: 'Petit-déjeuner', amount: 12, source: MID_STAY_SOURCE },
  ]);
  const { detail: next, amount } = mergeMidStayIntoDetail(detail, []);
  assert.deepEqual(next.map((l) => l.label), ['Ménage de fin de séjour']);
  assert.equal(amount, 60);
});

test('sasDetailAmount / storedMidStayLines split the stored detail in its two halves', () => {
  const detail = JSON.stringify([
    { label: 'Ménage de fin de séjour', amount: 60 },
    { label: 'Petit-déjeuner', amount: 12, source: MID_STAY_SOURCE, key: 'opt:9' },
    { label: 'Linge de toilette', amount: 18, source: 'arrivalBathLinen' },
  ]);
  assert.equal(sasDetailAmount(detail), 78, 'the arrival bath linen belongs to the SAS half');
  assert.deepEqual(storedMidStayLines(detail).map((l) => l.key), ['opt:9']);
  assert.equal(sasDetailAmount(null), 0);
  assert.deepEqual(storedMidStayLines('not json'), []);
});
