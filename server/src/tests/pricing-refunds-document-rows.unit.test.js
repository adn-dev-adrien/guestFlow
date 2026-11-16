// specs/pricing-components.md rules 72, 74, 75 and specs/outside-booking-sas.md rules 49, 52, 53 (stabilisation loop t2, B2-1 to B2-4) — the three figures of a
// sale document's lowered lines, each in its component: SETTLEMENT's transfer of what a lowered line holds onto the lines still due, REFUNDS' open rows in
// step with what is owed, and REFUNDS' choice of the line a refund leaves.
const test = require('node:test');
const assert = require('node:assert/strict');
const { refileDocumentExcess } = require('../utils/pricing/settlement');
const { documentRowsInStep, refundRowsOfDocument } = require('../utils/pricing/refunds/owed');

const BEER = 'line:a';
const PLANK = 'line:b';
const MORE = 'line:c';

test('refileDocumentExcess — the offered beers\' money pays the plank still due, the booked part first, one row per line and books', () => {
  const lines = [{ ref: BEER, totalCents: 1300, offered: true }, { ref: PLANK, totalCents: 1400 }];
  const allocations = [{ lineRef: BEER, amountCents: 800, books: 1 }, { lineRef: BEER, amountCents: 500, books: 0 }];
  assert.deepEqual(refileDocumentExcess({ lines, allocations }), [
    { lineRef: BEER, amountCents: -800, books: 1 }, { lineRef: PLANK, amountCents: 800, books: 1 },
    { lineRef: BEER, amountCents: -500, books: 0 }, { lineRef: PLANK, amountCents: 500, books: 0 },
  ]);
});

test('refileDocumentExcess — nothing moves when no line asks, or when no line holds more than it asks', () => {
  assert.deepEqual(refileDocumentExcess({
    lines: [{ ref: BEER, totalCents: 1300, offered: true }, { ref: PLANK, totalCents: 1400 }],
    allocations: [{ lineRef: BEER, amountCents: 1300, books: 1 }, { lineRef: PLANK, amountCents: 1400, books: 1 }],
  }), []);
  assert.deepEqual(refileDocumentExcess({ lines: [{ ref: BEER, totalCents: 1300 }, { ref: PLANK, totalCents: 1400 }], allocations: [{ lineRef: BEER, amountCents: 1300, books: 1 }] }), []);
});

test('refileDocumentExcess — the excess fills the due lines in sale order, the last one partly', () => {
  const lines = [{ ref: BEER, totalCents: 2000, cancelled: true }, { ref: PLANK, totalCents: 1400 }, { ref: MORE, totalCents: 1400 }];
  assert.deepEqual(refileDocumentExcess({ lines, allocations: [{ lineRef: BEER, amountCents: 2000, books: 1 }] }), [
    { lineRef: BEER, amountCents: -2000, books: 1 }, { lineRef: PLANK, amountCents: 1400, books: 1 }, { lineRef: MORE, amountCents: 600, books: 1 },
  ]);
});

test('documentRowsInStep — a row holds at most what its line still holds beyond what it asks; the newest is cut first to what is owed', () => {
  const rows = [{ id: 1, lineRef: BEER, amountCents: 1300 }, { id: 2, lineRef: PLANK, amountCents: 1400 }];
  const both = [{ ref: BEER, dueCents: 0, settledCents: 1300 }, { ref: PLANK, dueCents: 0, settledCents: 1400 }];
  assert.deepEqual(documentRowsInStep({ rows, lines: both, owedCents: 2700 }), { amounts: [{ id: 1, amountCents: 1300 }, { id: 2, amountCents: 1400 }], openCents: 0 });
  // The beers payable again: their row is no longer owed.
  const beersBack = [{ ref: BEER, dueCents: 1300, settledCents: 1300 }, { ref: PLANK, dueCents: 0, settledCents: 1400 }];
  assert.deepEqual(documentRowsInStep({ rows, lines: beersBack, owedCents: 1400 }).amounts, [{ id: 1, amountCents: 0 }, { id: 2, amountCents: 1400 }]);
  // Something more sold: what is owed falls, the newest row shrinks.
  assert.deepEqual(documentRowsInStep({ rows, lines: both, owedCents: 2000 }).amounts, [{ id: 1, amountCents: 1300 }, { id: 2, amountCents: 700 }]);
});

test('documentRowsInStep — a lowering opens what no row holds, at most its line\'s excess; the whole document cancelled opens what is owed', () => {
  const lines = [{ ref: BEER, dueCents: 0, settledCents: 1300 }, { ref: PLANK, dueCents: 0, settledCents: 1400 }];
  assert.equal(documentRowsInStep({ rows: [{ id: 1, lineRef: BEER, amountCents: 1300 }], lines, owedCents: 2700, open: { lineRef: PLANK } }).openCents, 1400);
  assert.equal(documentRowsInStep({ rows: [], lines, owedCents: 2700, open: { lineRef: BEER } }).openCents, 1300);
  assert.equal(documentRowsInStep({ rows: [], lines, owedCents: 2700, open: { lineRef: null } }).openCents, 2700);
  assert.equal(documentRowsInStep({ rows: [], lines, owedCents: 0, open: { lineRef: BEER } }).openCents, 0);
});

test('refundRowsOfDocument — the row\'s own line first, its booked part before its caisse interne, then the others in sale order, the rest on no line', () => {
  const lines = [{ ref: BEER, dueCents: 0, settledCents: 1300 }, { ref: PLANK, dueCents: 0, settledCents: 1400 }];
  const allocations = [{ lineRef: BEER, amountCents: 1300, books: 1 }, { lineRef: PLANK, amountCents: 1000, books: 1 }, { lineRef: PLANK, amountCents: 400, books: 0 }];
  assert.deepEqual(refundRowsOfDocument({ lines, allocations, amountCents: 1400, lineRef: PLANK }), [
    { lineRef: PLANK, amountCents: 1000, internal: false }, { lineRef: PLANK, amountCents: 400, internal: true },
  ]);
  assert.deepEqual(refundRowsOfDocument({ lines, allocations, amountCents: 3000, lineRef: null }), [
    { lineRef: BEER, amountCents: 1300, internal: false }, { lineRef: BEER, amountCents: 0, internal: true },
    { lineRef: PLANK, amountCents: 1000, internal: false }, { lineRef: PLANK, amountCents: 400, internal: true },
    { lineRef: null, amountCents: 300, internal: false },
  ]);
});

// Loop t5 D5-4 (2026-11-16) — the unnamed excess and the rest of the same line come out as one row per (line, caisse): two rows with the same
// key made `recordRefund` / `recordKept` write two allocations under one key, and the unique index refused the close every time.
test('refundRowsOfDocument — one row per line and caisse when the unnamed excess and the named rest of a line are both taken', () => {
  const lines = [{ ref: BEER, dueCents: 0, settledCents: 1300 }, { ref: PLANK, dueCents: 1000, settledCents: 0 }];
  const allocations = [{ lineRef: BEER, amountCents: 1300, books: 1 }];
  const rows = refundRowsOfDocument({ lines, allocations, amountCents: 1000, reserved: [{ lineRef: BEER, amountCents: 600 }] });
  assert.deepEqual(rows, [{ lineRef: BEER, amountCents: 1000, internal: false }, { lineRef: BEER, amountCents: 0, internal: true }]);
  const keys = rows.map((row) => `${row.lineRef}:${row.internal}`);
  assert.equal(new Set(keys).size, keys.length);
});
