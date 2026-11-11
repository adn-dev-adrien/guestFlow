// specs/resource-booking-pricing-and-invoicing.md rule 40 (R35-EXT-3, R35-M-L4, R35-S1) — the HT lines sent to Qonto
// always add up, line by line rounded, to the total charged: any line moves, a lone line out of reach gets a cent of
// « Arrondi de TVA », and a total nothing reaches is refused before Qonto numbers anything.
const test = require('node:test');
const assert = require('node:assert/strict');

const { createQontoInvoiceIssuer, wireItems, toExcludingVat, ttcOf } = require('../invoiceIssuer');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

const qontoTotal = (lines) => lines.reduce((sum, l) => sum + ttcOf(l.amountCents, l.vatRate), 0);
const naiveHt = (lines) => lines.map((l) => Math.round(l.amountCents / (1 + l.vatRate / 100)));

test('rule 40 — 15/25 €/h at 20 %, 18:00-20:00, 15 min offered: 36,25 € is reached by moving a line other than the largest', () => {
  const items = [{ title: 'Jour', amountCents: 1500, vatRate: 20 }, { title: 'Soir', amountCents: 2500, vatRate: 20 }];
  const discount = { title: 'Temps offert', amountCents: 375, vatRate: 20 };
  const all = [...items, { title: discount.title, amountCents: -375, vatRate: 20 }];
  assert.notEqual(qontoTotal(all.map((l, i) => ({ ...l, amountCents: naiveHt(all)[i] }))), 3625, 'the plain conversion misses it: the correction must run');
  const lines = wireItems(items, discount, 3625);
  assert.equal(qontoTotal(lines), 3625);
  assert.equal(lines.length, 3);
});

test('rule 40 — a single line whose TTC no HT reaches gets a cent of « Arrondi de TVA »', () => {
  for (const [cents, rate] of [[5625, 20], [6000, 10], [2100, 5.5]]) {
    const lines = toExcludingVat([{ title: 'Bain', amountCents: cents, vatRate: rate }], cents);
    assert.equal(qontoTotal(lines), cents, `${cents} at ${rate} %`);
    assert.equal(lines.length, 2);
    assert.equal(lines[1].title, 'Arrondi de TVA');
    assert.ok(Math.abs(lines[1].amountCents) <= 2);
  }
});

test('rule 40 — every whole-euro and quarter-hour total of the bath reaches its TTC at 20, 10 and 5,5 %', () => {
  const missed = [];
  for (const rate of [20, 10, 5.5]) {
    for (let day = 0; day <= 12000; day += 625) {
      for (let evening = 0; evening <= 8000; evening += 875) {
        for (const offered of [0, 1250, 1750, 2500]) {
          const items = [day, evening].filter((c) => c > 0).map((c, i) => ({ title: `l${i}`, amountCents: c, vatRate: rate }));
          const total = day + evening - offered;
          if (!items.length || total <= 0) continue;
          const lines = wireItems(items, offered ? { title: 'Temps offert', amountCents: offered, vatRate: rate } : null, total);
          if (!lines || qontoTotal(lines) !== total) missed.push([rate, day, evening, offered]);
        }
      }
    }
  }
  assert.deepEqual(missed, []);
});

test('rule 40 — a total no line set reaches is refused before any call to Qonto', async () => {
  const calls = [];
  const issuer = createQontoInvoiceIssuer({
    store: () => ({ qontoConnected: () => true }), iban: () => 'FR76',
    withQontoImpl: async () => { calls.push('qonto'); throw new Error('must not be called'); },
  });
  await assert.rejects(issuer.issue({
    idempotencyKey: 'k', client: { lastName: 'Lune' }, issueDate: `${Y}-02-13`, performanceDate: `${Y}-02-13`,
    items: [{ title: 'Bain', amountCents: 1001, vatRate: 100 }], discount: null, expectedTotalCents: 1001, paid: true,
  }), { code: 'ISSUER_AMOUNT_UNREACHABLE' });
  assert.deepEqual(calls, []);
});
