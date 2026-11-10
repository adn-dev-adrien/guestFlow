// specs/resource-booking-pricing-and-invoicing.md rule 48 (verification R36b L3) — the sign guard binds only on lines of a
// few cents, where the quarter-euro sweep of invoice-issuer-folded-signs never reaches: every non-discount line stays at
// 1 cent HT or more, the folded fallback's « Arrondi de TVA » line is positive, the discount stays at −1 cent or less, and
// the total Qonto computes is the total charged (a charged total the positive lines cannot reach is refused, null). Kills the reviewer's mutants M18 (sign filter removed), M20 (folded
// rounding back to −1 / −2) and M22 (a positive line allowed down to 0 HT).
const test = require('node:test');
const assert = require('node:assert/strict');

const { foldedItems, wireItems, ttcOf } = require('../invoiceIssuer');

const DISCOUNT = 'Temps offert';
const qontoTotal = (lines) => lines.reduce((sum, l) => sum + ttcOf(l.amountCents, l.vatRate), 0);
const bands = (a, b, rate) => [{ title: 'Jour', amountCents: a, vatRate: rate }, ...(b > 0 ? [{ title: 'Soir', amountCents: b, vatRate: rate }] : [])];

function wrongOf(lines, total) {
  if (!lines) return null;
  if (lines.some((l) => l.title !== DISCOUNT && l.amountCents < 1)) return `line < 1 cent: ${JSON.stringify(lines.map((l) => l.amountCents))}`;
  if (lines.some((l) => l.title === DISCOUNT && l.amountCents > -1)) return `discount > −1 cent: ${JSON.stringify(lines.map((l) => l.amountCents))}`;
  if (qontoTotal(lines) !== total) return `total ${qontoTotal(lines)} for ${total}`;
  return null;
}

test('rule 48 — the main path, 1 c + 3 c at 20 % for 4 c: both lines at 1 cent HT or more, Qonto\'s total exact', () => {
  const lines = wireItems(bands(1, 3, 20), null, 4);
  assert.ok(lines, 'reachable');
  assert.equal(wrongOf(lines, 4), null, JSON.stringify(lines));
});

test('rule 48 — the folded path, 1 c + 4 c with 1 c offered at 20 %: every line positive, the rounding line too, total exact', () => {
  const lines = foldedItems(bands(1, 4, 20), { title: DISCOUNT, amountCents: 1, vatRate: 20 }, 4);
  assert.ok(lines, 'reachable');
  assert.equal(wrongOf(lines, 4), null, JSON.stringify(lines));
});

test('rule 48 — the folded path asked a total below what its positive lines reach: null, never a negative rounding line', () => {
  const lines = foldedItems(bands(1, 2, 20), { title: DISCOUNT, amountCents: 1, vatRate: 20 }, 1);
  assert.equal(lines, null, JSON.stringify(lines));
});

test('rule 48 — every cent-level case, both paths: no line loses its sign, every total reached is exact', () => {
  const wrong = [];
  let reached = 0;
  for (const rate of [20, 10, 5.5]) {
    for (let a = 1; a <= 60; a += 1) {
      for (let b = 0; b <= 12; b += 1) {
        for (const off of [0, 1, 2, 3, a - 1, a - 2]) {
          const total = a + b - off;
          if (off < 0 || total <= 0) continue;
          const discount = { title: DISCOUNT, amountCents: off, vatRate: rate };
          const results = [['wire', wireItems(bands(a, b, rate), off ? discount : null, total), total]];
          if (off) {
            for (const short of [0, 1, 2]) {
              if (total - short > 0) results.push(['fold', foldedItems(bands(a, b, rate), discount, total - short), total - short]);
            }
          }
          for (const [path, lines, asked] of results) {
            if (lines) reached += 1;
            const why = wrongOf(lines, asked);
            if (why && wrong.length < 5) wrong.push({ path, a, b, off, rate, why });
          }
        }
      }
    }
  }
  assert.ok(reached > 5000, `${reached} cases reached`);
  assert.deepEqual(wrong, []);
});
