// specs/pricing-components.md §3 rules 51, 61, 62 and 65 — the VAT component alone: the rate by (vatClass, customerContext)
// under the subject and franchise regimes, one rounding per (vatClass, rate, customerContext) group, the allocation to the
// group's amounts summing to the group, the per-rate output, and equality with each former copy of the split on a sweep
// of amounts and rates. The golden months and the price gate (run beside this suite) prove the switched readers on the
// production copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  vatOf, resolveRate, splitTtc, netFirst, htOfPortion, rateToBasis, lineTotalCents, htFromTtc, settingsSchema,
} = require('../utils/pricing/vat');
const { rateKey } = require('../utils/pricing/vat/settingsSchema');

const SUBJECT = { regime: 'subject', rate: 10 };
const FRANCHISE = { regime: 'not_subject', rate: 0 };
const amount = (amountCents, vatClass, customerContext = 'hosted') => ({ amountCents, vatClass, customerContext, source: { kind: 'line' } });

test('rule 61 — resolveRate: hosted follows the regime, a set key wins, outOfScope is 0, franchise is 0 whatever the keys say', () => {
  assert.equal(resolveRate('accommodation', 'hosted', { regime: SUBJECT }), 10);
  assert.equal(resolveRate('options', 'hosted', { regime: { regime: 'subject', rate: 20 } }), 20);
  assert.equal(resolveRate('options', 'hosted', { regime: SUBJECT, settings: { [rateKey('options', 'hosted')]: 5.5 } }), 5.5);
  assert.equal(resolveRate('options', 'hosted', { regime: SUBJECT, settings: new Map([[rateKey('options', 'hosted')]]) }), 10, 'an unset key follows the regime');
  assert.equal(resolveRate('outOfScope', 'hosted', { regime: SUBJECT }), 0);
  assert.equal(resolveRate('options', 'hosted', { regime: FRANCHISE, settings: { [rateKey('options', 'hosted')]: 5.5 } }), 0);
  assert.equal(resolveRate('resources', 'external', { regime: SUBJECT, settings: { [rateKey('resources', 'external')]: 20 } }), 20);
});

test('rule 61 — an external rate nobody set is refused, never guessed from the stay\'s regime', () => {
  assert.throws(() => resolveRate('resources', 'external', { regime: SUBJECT }), (error) => error.code === 'VAT_RATE_UNKNOWN');
});

test('rule 62 — the VAT is rounded once per group, on the group\'s total, not once per amount', () => {
  // Three amounts of 0.05 € at 10 %: each alone has a VAT of 0.00 (rounded), the group of 0.15 € has 0.01.
  const out = vatOf([amount(5, 'options'), amount(5, 'options'), amount(5, 'options')], { regime: SUBJECT });
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0].ttcCents, 15);
  assert.equal(out.groups[0].vatCents, 1);
  assert.equal(out.groups[0].netCents, 14);
  assert.equal(out.totals.vatCents, 1);
});

test('rule 62 — the allocation to the amounts sums to the group, in proportion, largest remainder first', () => {
  const out = vatOf([amount(3333, 'accommodation'), amount(3333, 'accommodation'), amount(3334, 'accommodation')], { regime: SUBJECT });
  const [group] = out.groups;
  assert.equal(group.vatCents, 909);
  assert.equal(out.amounts.reduce((sum, a) => sum + a.vatCents, 0), group.vatCents);
  assert.equal(out.amounts.reduce((sum, a) => sum + a.netCents, 0), group.netCents);
  assert.deepEqual(out.amounts.map((a) => a.vatCents), [303, 303, 303]);
  const uneven = vatOf([amount(100, 'options'), amount(1, 'options')], { regime: SUBJECT });
  assert.equal(uneven.amounts[0].vatCents + uneven.amounts[1].vatCents, uneven.groups[0].vatCents);
  assert.ok(uneven.amounts.every((a) => a.vatCents + a.netCents === a.amountCents));
});

test('rule 62 — groups split by vatClass, rate and customerContext; a negative group (a discount) allocates with its sign', () => {
  const settings = { [rateKey('resources', 'external')]: 20 };
  const out = vatOf([
    amount(11000, 'accommodation'), amount(5500, 'options'), amount(2400, 'resources', 'external'), amount(500, 'outOfScope'), amount(-1100, 'options'),
  ], { regime: SUBJECT, settings });
  assert.deepEqual(out.groups.map((g) => [g.vatClass, g.rate, g.customerContext]), [
    ['accommodation', 10, 'hosted'], ['options', 10, 'hosted'], ['resources', 20, 'external'], ['outOfScope', 0, 'hosted'],
  ]);
  const options = out.groups.find((g) => g.vatClass === 'options');
  assert.equal(options.ttcCents, 4400);
  assert.equal(options.vatCents, 400);
  assert.deepEqual(out.amounts.filter((a) => a.vatClass === 'options').map((a) => a.vatCents), [500, -100]);
  assert.equal(out.groups.find((g) => g.vatClass === 'outOfScope').vatCents, 0);
});

test('rule 51 — byRate sums the groups of one rate (one row per rate), and the totals sum every group', () => {
  const out = vatOf([amount(11000, 'accommodation'), amount(5500, 'options'), amount(2400, 'resources'), amount(500, 'outOfScope')], { regime: SUBJECT });
  assert.deepEqual(out.byRate, [
    { rate: 10, ttcCents: 18900, vatCents: 1718, netCents: 17182 },
    { rate: 0, ttcCents: 500, vatCents: 0, netCents: 500 },
  ]);
  assert.deepEqual(out.totals, { ttcCents: 19400, vatCents: 1718, netCents: 17682 });
});

test('rule 51 — franchise: every rate is 0, the net is the amount', () => {
  const out = vatOf([amount(11000, 'accommodation'), amount(5500, 'options')], { regime: FRANCHISE });
  assert.deepEqual(out.byRate, [{ rate: 0, ttcCents: 16500, vatCents: 0, netCents: 16500 }]);
});

test('rule 61 — an empty or missing list is an empty result', () => {
  for (const list of [[], null, undefined]) {
    assert.deepEqual(vatOf(list, { regime: SUBJECT }), { amounts: [], groups: [], byRate: [], totals: { ttcCents: 0, vatCents: 0, netCents: 0 } });
  }
});

// ---- the former copies, reproduced from the code this unit replaced ---------------------------------------------------
const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
const engineFamily = (base, rate) => { const vat = round2(base * (rate / (100 + rate))); return { vat, net: round2(base - vat) }; };
const accountingBucket = (ttc, ratePercent) => {
  if (!ttc || ttc <= 0) return { ht: 0, vat: 0 };
  const rate = Number(ratePercent || 0);
  const vat = round2(ttc * (rate / (100 + rate)));
  return { ht: round2(ttc - vat), vat };
};
const hourlyVatOf = (total, rate) => { const net = round2(total / (1 + rate / 100)); return { amount: round2(total - net), net }; };
const financeHt = (r, portion, vatRate) => {
  if (portion <= 0) return 0;
  const finalPrice = Math.max(0, Number(r.finalPrice || 0));
  const tax = Math.max(0, Number(r.touristTaxTotal || 0));
  const fullTtc = finalPrice + tax;
  if (fullTtc <= 0) return 0;
  return round2(portion * ((finalPrice / (1 + vatRate / 100)) / fullTtc));
};
const RATES = [0, 2.1, 5.5, 8.5, 10, 20];
const SWEEP = Array.from({ length: 1500 }, (_, i) => Math.round(((i * 7919) % 400000) + (i % 100)) / 100);

test('rule 65 — splitTtc is the engine\'s family split and the accounting bucket\'s, to the cent, on a sweep of amounts and rates', () => {
  for (const rate of RATES) {
    for (const ttc of SWEEP) {
      const { vat, net } = splitTtc(ttc, rate);
      assert.deepEqual({ vat, net }, engineFamily(ttc, rate), `${ttc} @ ${rate}`);
      if (ttc > 0) assert.deepEqual({ vat, ht: net }, { vat: accountingBucket(ttc, rate).vat, ht: accountingBucket(ttc, rate).ht });
    }
  }
});

test('rule 65 — vatOf on one family group equals the engine\'s split of that family', () => {
  for (const rate of RATES) {
    for (const ttc of SWEEP) {
      const out = vatOf([amount(Math.round(ttc * 100), 'options')], { regime: { regime: 'subject', rate } });
      const expected = engineFamily(ttc, rate);
      assert.equal(out.groups[0].vatCents, Math.round(expected.vat * 100), `${ttc} @ ${rate}`);
      assert.equal(out.groups[0].netCents, Math.round(expected.net * 100));
    }
  }
});

test('rule 65 — netFirst is the hourly bookings\' split, htOfPortion the finance pages\' HT', () => {
  for (const rate of RATES) {
    for (const total of SWEEP.slice(0, 400)) assert.deepEqual(netFirst(total, rate), hourlyVatOf(total, rate), `${total} @ ${rate}`);
  }
  for (const row of [{ finalPrice: 480, touristTaxTotal: 13.2 }, { finalPrice: 0, touristTaxTotal: 5 }, { finalPrice: 333.33, touristTaxTotal: 0 }, {}]) {
    for (const portion of [0, -5, 12.34, 100, 479.99]) {
      assert.equal(htOfPortion({ portion, finalPrice: row.finalPrice, touristTaxTotal: row.touristTaxTotal, vatRate: 10 }), financeHt(row, portion, 10));
    }
  }
});

test('rule 65 — the Qonto basket helpers keep their integer-cent arithmetic', () => {
  assert.equal(rateToBasis(10), 1000);
  assert.equal(rateToBasis(8.5), 850);
  assert.equal(rateToBasis(null), 0);
  assert.equal(lineTotalCents(23295, 1000), 25625, 'half up, integer exact');
  assert.equal(lineTotalCents(100, 0), 100);
  assert.equal(htFromTtc(25625, 1000), 23295);
  assert.equal(htFromTtc(100, 0), 100);
  for (const R of [1000, 850, 2000]) {
    for (let ttc = 1; ttc < 4000; ttc += 37) assert.ok(lineTotalCents(htFromTtc(ttc, R), R) <= ttc);
  }
});

test('rule 50 — settingsSchema declares the regime and a rate per (vatClass, customerContext), null following the regime', () => {
  const by = Object.fromEntries(settingsSchema.map((entry) => [entry.key, entry]));
  assert.equal(by.regime.default, 'subject');
  assert.notEqual(by.regime.validate('exempt'), null);
  assert.equal(by[rateKey('options', 'hosted')].default, null);
  assert.equal(by[rateKey('options', 'hosted')].validate(null), null);
  assert.equal(by[rateKey('options', 'hosted')].validate(5.5), null);
  assert.notEqual(by[rateKey('options', 'hosted')].validate(120), null);
  assert.equal(settingsSchema.length, 1 + 4 * 2);
});
