// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 27 — crop marks on every printed page (recto-verso included), at the cut lines of the grid, inside the printable area:
// none closer than the minimum margin to the sheet's edge.
const test = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../printLayout');

const planOf = (mode, perSheet, count = perSheet, flip = 'left-right') => {
  const planned = layout.plan({ mode, perSheet, count, flip });
  assert.equal(planned.ok, true, JSON.stringify(planned));
  return planned.layout;
};

const COMBOS = [['recto-verso', 1], ['recto-verso', 2], ['recto-verso', 4], ['recto-verso', 8], ['side-by-side', 1], ['side-by-side', 2], ['side-by-side', 4]];

test('every page of every mode carries crop marks, each inside the sheet and at least MARK_EDGE from its edge', () => {
  COMBOS.forEach(([mode, perSheet]) => {
    planOf(mode, perSheet).pages.forEach((page) => {
      assert.ok(page.marks.length > 0, `${mode} ${perSheet}: page ${page.number} has marks`);
      page.marks.forEach((m) => {
        [[m.x1, page.sheet.widthMm], [m.x2, page.sheet.widthMm]].forEach(([x, width]) => assert.ok(x >= layout.MARK_EDGE - 1e-6 && x <= width - layout.MARK_EDGE + 1e-6, `${mode} ${perSheet}: x ${x}`));
        [[m.y1, page.sheet.heightMm], [m.y2, page.sheet.heightMm]].forEach(([y, height]) => assert.ok(y >= layout.MARK_EDGE - 1e-6 && y <= height - layout.MARK_EDGE + 1e-6, `${mode} ${perSheet}: y ${y}`));
      });
    });
  });
});

test('the marks sit on the grid lines: a vertical mark at the x of a card edge, a horizontal one at the y of a card edge', () => {
  const page = planOf('recto-verso', 4).pages[0];
  const xs = new Set(page.cells.flatMap((c) => [c.xMm, Number((c.xMm + c.widthMm).toFixed(2))]));
  const ys = new Set(page.cells.flatMap((c) => [c.yMm, Number((c.yMm + c.heightMm).toFixed(2))]));
  const near = (set, value) => [...set].some((v) => Math.abs(v - value) < 0.02);
  const vertical = page.marks.filter((m) => m.x1 === m.x2);
  assert.ok(vertical.length >= 6, 'three lines, above and below');
  vertical.forEach((m) => assert.ok(near(xs, m.x1), `x ${m.x1}`));
  page.marks.filter((m) => m.y1 === m.y2).forEach((m) => assert.ok(near(ys, m.y1), `y ${m.y1}`));
});

test('at 94 % the side margins are 6.3 mm: no mark fits there, the marks go above and below; at full size they go all around', () => {
  const reduced = planOf('recto-verso', 4).pages[0];
  assert.deepEqual(reduced.marks.filter((m) => m.y1 === m.y2), []);
  assert.ok(reduced.marks.some((m) => m.x1 === m.x2));
  const full = planOf('recto-verso', 1).pages[0];
  assert.ok(full.marks.some((m) => m.y1 === m.y2) && full.marks.some((m) => m.x1 === m.x2));
});

test('the verso page of a recto-verso sheet has the same marks as its recto', () => {
  const [recto, verso] = planOf('recto-verso', 4).pages;
  assert.deepEqual(verso.marks, recto.marks);
});
