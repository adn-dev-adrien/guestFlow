// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 23, 24 (K6) — the layout says what its sheet is in one sentence, captions its pages, and turns the backs half a turn
// for a sheet flipped like a calendar page.
const test = require('node:test');
const assert = require('node:assert/strict');
const { plan } = require('../printLayout');

const layoutOf = (input) => { const planned = plan(input); assert.equal(planned.ok, true, JSON.stringify(planned)); return planned.layout; };

test('the description names the sheet, the grid and the scale', () => {
  assert.equal(layoutOf({ mode: 'recto-verso', perSheet: 8, count: 8, flip: 'left-right' }).description, 'Feuille A4 paysage, 4 × 2, cartes à 66 % (≈ 69 × 98 mm)');
  assert.equal(layoutOf({ mode: 'recto-verso', perSheet: 4, count: 4, flip: 'left-right' }).description, 'Feuille A4 portrait, 2 × 2, cartes à 94 % (≈ 99 × 139 mm)');
  assert.equal(layoutOf({ mode: 'recto-verso', perSheet: 1, count: 1, flip: 'left-right' }).description, 'Feuille A4 portrait, 1 × 1, cartes à taille réelle (105 × 148 mm)');
  assert.equal(layoutOf({ mode: 'side-by-side', perSheet: 2, count: 2 }).description, 'Feuille A4 portrait, 1 × 2 paires à plier, cartes à 94 % (≈ 99 × 139 mm)');
});

test('the pages are captioned Recto / Verso by sheet, a folded sheet by its number', () => {
  const rectoVerso = layoutOf({ mode: 'recto-verso', perSheet: 2, count: 3, flip: 'left-right' });
  assert.deepEqual(rectoVerso.pages.map((page) => page.caption), ['Feuille 1 · Recto', 'Feuille 1 · Verso', 'Feuille 2 · Recto', 'Feuille 2 · Verso']);
  assert.deepEqual(layoutOf({ mode: 'side-by-side', perSheet: 2, count: 3 }).pages.map((page) => page.caption), ['Feuille 1', 'Feuille 2']);
});

test('K6 — flipped like a calendar page the backs are rotated half a turn; flipped like a book page they are not', () => {
  const calendar = layoutOf({ mode: 'recto-verso', perSheet: 4, count: 4, flip: 'top-bottom' });
  assert.deepEqual([...new Set(calendar.pages[1].cells.map((cell) => cell.rotateDeg))], [180]);
  assert.deepEqual([...new Set(calendar.pages[0].cells.map((cell) => cell.rotateDeg))], [undefined], 'the fronts are not turned');
  const book = layoutOf({ mode: 'recto-verso', perSheet: 4, count: 4, flip: 'left-right' });
  assert.deepEqual([...new Set(book.pages[1].cells.map((cell) => cell.rotateDeg))], [0]);
});
