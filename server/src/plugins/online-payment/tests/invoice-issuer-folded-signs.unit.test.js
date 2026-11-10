// specs/resource-booking-pricing-and-invoicing.md rule 48 (audit R36-EXT-2) — the folded fallback (sent after Qonto refused
// a negative discount line) never sends a 0 € line nor a negative HT line: a band the discount covers whole is left out, the
// cents land on positive lines, the rounding line is positive; nothing reachable = null (ISSUER_AMOUNT_UNREACHABLE). The
// main path keeps each line's sign too. The auditor's sweep, exhaustive: two bands from 1 € to 90 € by 0,25 € at 20, 10 and
// 5,5 %, the discount equal to the larger band, then to the smaller one.
const test = require('node:test');
const assert = require('node:assert/strict');

const { foldedItems, wireItems, ttcOf } = require('../invoiceIssuer');

const qontoTotal = (lines) => lines.reduce((sum, l) => sum + ttcOf(l.amountCents, l.vatRate), 0);

function sweep(discountOf, check) {
  const wrong = [];
  let cases = 0;
  for (const rate of [20, 10, 5.5]) {
    for (let a = 100; a <= 9000; a += 25) {
      for (let b = 100; b <= 9000; b += 25) {
        const items = [{ title: 'Jour', amountCents: a, vatRate: rate }, { title: 'Soir', amountCents: b, vatRate: rate }];
        const discount = { title: 'Temps offert', amountCents: discountOf(a, b), vatRate: rate };
        const total = a + b - discount.amountCents;
        if (total <= 0) continue;
        cases += 1;
        const why = check(items, discount, total);
        if (why && wrong.length < 5) wrong.push({ a, b, rate, why });
      }
    }
  }
  return { cases, wrong };
}

const foldedCheck = (items, discount, total) => {
  const lines = foldedItems(items, discount, total);
  if (!lines) return 'unreached';
  if (lines.some((l) => l.amountCents <= 0)) return `line ≤ 0: ${JSON.stringify(lines.map((l) => l.amountCents))}`;
  if (qontoTotal(lines) !== total) return `total ${qontoTotal(lines)}`;
  return null;
};

test('rule 48 — the discount equal to the larger band: one line left, never 0 € nor negative, the total reached', () => {
  const { cases, wrong } = sweep((a, b) => Math.max(a, b), foldedCheck);
  assert.ok(cases > 380000, `${cases} cases`);
  assert.deepEqual(wrong, []);
});

test('rule 48 — the discount equal to the smaller band: the same', () => {
  const { wrong } = sweep((a, b) => Math.min(a, b), foldedCheck);
  assert.deepEqual(wrong, []);
});

test('rule 48 — the audit\'s case: 2,25 € + 2,25 €, 2,25 € offered at 20 % goes out as one positive line', () => {
  const items = [{ title: 'Jour', amountCents: 225, vatRate: 20 }, { title: 'Soir', amountCents: 225, vatRate: 20 }];
  const lines = foldedItems(items, { title: 'Temps offert', amountCents: 225, vatRate: 20 }, 225);
  assert.equal(lines.filter((l) => l.title !== 'Arrondi de TVA').length, 1);
  assert.ok(lines.every((l) => l.amountCents > 0), JSON.stringify(lines));
  assert.equal(qontoTotal(lines), 225);
});

test('rule 48 — everything offered leaves nothing to fold: null, the caller refuses before Qonto', () => {
  const items = [{ title: 'Jour', amountCents: 500, vatRate: 20 }];
  assert.equal(foldedItems(items, { title: 'Temps offert', amountCents: 500, vatRate: 20 }, 0), null);
});

test('rule 48 — the main path keeps each sign: bands positive, the discount negative', () => {
  const { wrong } = sweep((a, b) => Math.max(a, b) - 25, (items, discount, total) => {
    const lines = wireItems(items, discount, total);
    if (!lines) return null;
    const [day, evening, cut] = lines;
    if (day.amountCents < 1 || evening.amountCents < 1 || cut.amountCents > -1) return JSON.stringify(lines.map((l) => l.amountCents));
    if (qontoTotal(lines) !== total) return `total ${qontoTotal(lines)}`;
    return null;
  });
  assert.deepEqual(wrong, []);
});
