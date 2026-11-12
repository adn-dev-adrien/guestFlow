// specs/pricing-components.md §3 rules 64 and 65 (Q-C8) — the Qonto invoice issuer cuts the VAT through the VAT component and not through a
// formula of its own, and no issued document moves: the HT of a line and the TTC Qonto will compute are the float arithmetic the issuer
// always used (`netFirstCents` / `ttcFromNetCents`), for every rate and every cent amount of a fuzz.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vat = require('../utils/pricing/vat');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const issuer = optionalPlugin(() => require('../plugins/online-payment/invoiceIssuer'));
const RATES = [0, 2.1, 5.5, 8.5, 10, 20];

// The arithmetic of invoiceIssuer.js before PR C, verbatim.
const originalBase = (amountCents, vatRate) => Math.round(amountCents / (1 + Number(vatRate || 0) / 100));
const originalTtcOf = (htCents, rate) => Math.round(htCents * (1 + Number(rate || 0) / 100));

test('rules 64, 65 — the component\'s cents strategies equal the issuer\'s former arithmetic, to the cent, on every rate', () => {
  for (const rate of [...RATES, undefined, null, '10']) {
    for (let cents = -3000; cents <= 60000; cents += 1) {
      assert.equal(vat.netFirstCents(cents, rate), originalBase(cents, rate), `${cents} @ ${rate}`);
      assert.equal(vat.ttcFromNetCents(cents, rate), originalTtcOf(cents, rate), `${cents} @ ${rate}`);
    }
  }
});

test('rules 64, 65 — the issuer cuts the VAT through the component: a basket without a discount keeps its figures', { skip: skipWithout(['online-payment']) }, () => {
  const items = [{ title: 'Séjour', amountCents: 45000, vatRate: 10 }, { title: 'Bain', amountCents: 6000, vatRate: 20 }, { title: 'Option', amountCents: 1999, vatRate: 5.5 }];
  const total = 45000 + 6000 + 1999;
  const wired = issuer.wireItems(items, null, total);
  assert.ok(wired, 'the basket is solved');
  const ttc = wired.reduce((sum, line) => sum + originalTtcOf(line.amountCents, line.vatRate), 0);
  assert.equal(ttc, total, 'the totals Qonto computes add up to the total charged');
  assert.deepEqual(issuer.wireItems(items, null, null).map((l) => l.amountCents), items.map((i) => originalBase(i.amountCents, i.vatRate)));
});

test('rule 65 — on 10 % and 20 % the integer-exact lineTotalCents agrees with the issuer\'s arithmetic (so a later switch moves nothing there); other rates are the listed class C-E9', () => {
  for (const rate of [10, 20]) {
    const basis = vat.rateToBasis(rate);
    for (let ht = 0; ht <= 200000; ht += 1) assert.equal(vat.lineTotalCents(ht, basis), vat.ttcFromNetCents(ht, rate), `${ht} @ ${rate}`);
  }
});

test('rule 65 — no VAT formula is left in the invoice issuer', { skip: skipWithout(['online-payment']) }, () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'online-payment', 'invoiceIssuer.js'), 'utf8');
  assert.ok(!/\/\s*\(\s*1\s*\+/.test(source) && !/\*\s*\(\s*1\s*\+/.test(source));
});
