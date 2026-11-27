// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 27 (K11) — crop marks on every printed page, recto-verso included: every cut line of the grid has its marks, each starting 3 mm
// from the sheet's edge, at least 2 mm long and 1 mm from any card. A table over every mode × cards per sheet × flip × count.
const test = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../printLayout');

const COMBOS = Object.entries(layout.TABLE).flatMap(([mode, rows]) => Object.keys(rows).map((perSheet) => [mode, Number(perSheet)]));
const COUNTS = [1, 2, 3, 4, 5, 7, 8, 9, 17];
const EPS = 1e-6;
// K11, written out literally: the rule is judged here, never against the module's own constants (a change of one must break this suite).
const K11 = { edgeMm: 3, minLengthMm: 2, gapMm: 1 };

// The cut lines of a page: every card edge of a recto-verso sheet; for a side-by-side sheet the edges of the pairs (the fold in the middle is not cut).
function cutLines(page) {
  const folds = new Set(page.folds.map((fold) => fold.x1));
  const xs = new Set();
  const ys = new Set();
  page.cells.forEach((cell) => {
    [cell.xMm, Number((cell.xMm + cell.widthMm).toFixed(2))].filter((x) => !folds.has(x)).forEach((x) => xs.add(x));
    [cell.yMm, Number((cell.yMm + cell.heightMm).toFixed(2))].forEach((y) => ys.add(y));
  });
  return { xs: [...xs], ys: [...ys] };
}

// The distance from a segment (horizontal or vertical) to a rectangle.
const distanceToRect = (mark, cell) => {
  const lo = { x: Math.min(mark.x1, mark.x2), y: Math.min(mark.y1, mark.y2) };
  const hi = { x: Math.max(mark.x1, mark.x2), y: Math.max(mark.y1, mark.y2) };
  const dx = Math.max(cell.xMm - hi.x, lo.x - (cell.xMm + cell.widthMm), 0);
  const dy = Math.max(cell.yMm - hi.y, lo.y - (cell.yMm + cell.heightMm), 0);
  return Math.hypot(dx, dy);
};

for (const [mode, perSheet] of COMBOS) {
  for (const flip of mode === 'recto-verso' ? layout.FLIPS : [null]) {
    test(`${mode}, ${perSheet} per sheet${flip ? `, ${flip}` : ''}: every cut line has marks, 3 mm from the edge, 2 mm long, 1 mm from any card, for every count`, () => {
      COUNTS.forEach((count) => {
        const planned = layout.plan({ mode, perSheet, count, flip });
        assert.equal(planned.ok, true, JSON.stringify(planned));
        planned.layout.pages.forEach((page) => {
          const { xs, ys } = cutLines(page);
          const where = `${mode} ${perSheet} ${flip} count ${count} page ${page.number}`;
          assert.ok(page.marks.length > 0, `${where}: marks`);
          page.marks.forEach((m) => {
            [m.x1, m.x2].forEach((x) => assert.ok(x >= K11.edgeMm - EPS && x <= page.sheet.widthMm - K11.edgeMm + EPS, `${where}: x ${x} within 3 mm of the edge`));
            [m.y1, m.y2].forEach((y) => assert.ok(y >= K11.edgeMm - EPS && y <= page.sheet.heightMm - K11.edgeMm + EPS, `${where}: y ${y} within 3 mm of the edge`));
            assert.ok(Math.hypot(m.x2 - m.x1, m.y2 - m.y1) >= K11.minLengthMm - EPS, `${where}: shorter than 2 mm`);
            page.cells.forEach((cell) => assert.ok(distanceToRect(m, cell) >= K11.gapMm - EPS, `${where}: a mark within 1 mm of a card`));
          });
          // Every cut line has a mark on each side of the grid.
          const vertical = page.marks.filter((m) => m.x1 === m.x2);
          const horizontal = page.marks.filter((m) => m.y1 === m.y2);
          xs.forEach((x) => assert.ok(vertical.filter((m) => Math.abs(m.x1 - x) < 0.02).length >= 2, `${where}: vertical line ${x} marked above and below`));
          ys.forEach((y) => assert.ok(horizontal.filter((m) => Math.abs(m.y1 - y) < 0.02).length >= 2, `${where}: horizontal line ${y} marked left and right`));
        });
      });
    });
  }
}

test('the verso page of a recto-verso sheet has the same marks as its recto', () => {
  const [recto, verso] = layout.plan({ mode: 'recto-verso', perSheet: 4, count: 4, flip: 'left-right' }).layout.pages;
  assert.deepEqual(verso.marks, recto.marks);
});
