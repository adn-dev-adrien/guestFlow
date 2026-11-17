// specs/resource-booking-pricing-and-invoicing.md rules 40, 48, 53 and Q3; specs/outside-booking-sas.md rules 56 (e), 57 (c) (stabilisation loop t5 B5-3) — when Qonto
// refuses a negative line, the discount is folded into its group's lines and no line may be negative, the rounding line included. A group whose cut no
// single line carries then needs the line moved further AND an « Arrondi de TVA » line, or a rounding line that carries a cent of VAT itself. Every
// basket the ungrouped solver invoiced folded stays invoiceable, with the VAT per rate the journal cuts once per group.
const test = require('node:test');
const assert = require('node:assert/strict');
const { wireItems, foldedItems, ttcOf } = require('../invoiceIssuer');
const { groupVatCents } = require('../../../utils/pricing/vat');

const vatByRate = (wired) => {
  const out = new Map();
  for (const item of wired) out.set(item.vatRate, (out.get(item.vatRate) || 0) + ttcOf(item.amountCents, item.vatRate) - item.amountCents);
  return out;
};
const totalOf = (wired) => wired.reduce((sum, item) => sum + ttcOf(item.amountCents, item.vatRate), 0);
const ungrouped = (item) => {
  const { vatGroup, ...rest } = item;
  return rest;
};

test('B5-3 — a 14,00 € session with 11,69 € offered at 20 %, folded: 1,89 € HT + a 0,03 € rounding line, VAT 0,39 like the journal', () => {
  const items = [{ title: 'Séance', amountCents: 1400, vatRate: 20, vatGroup: 'options|20' }];
  const discount = { title: '1 h offerte', amountCents: 1169, vatRate: 20, vatGroup: 'options|20' };
  const folded = foldedItems(items, discount, 231);
  assert.ok(folded, 'before: null, « facture à établir dans Qonto »');
  assert.equal(totalOf(folded), 231);
  assert.equal(vatByRate(folded).get(20), groupVatCents(231, 20));
  assert.deepEqual(folded.map((item) => [item.title, item.amountCents]), [['Séance', 189], ['Arrondi de TVA', 3]]);
  assert.ok(folded.every((item) => item.amountCents > 0 && !('vatGroup' in item) && !('rounding' in item)));
});

test('B5-3 — 5,50 € − 1,95 € at 5,5 %: no line under 10 cents HT carries VAT, the rounding line grows until it does', () => {
  const items = [{ title: 'Planche', amountCents: 550, vatRate: 5.5, vatGroup: 'catering|5.5' }];
  const discount = { title: 'Remise', amountCents: 195, vatRate: 5.5, vatGroup: 'catering|5.5' };
  const folded = foldedItems(items, discount, 355);
  assert.ok(folded);
  assert.equal(totalOf(folded), 355);
  assert.equal(vatByRate(folded).get(5.5), groupVatCents(355, 5.5));
  assert.ok(folded.every((item) => item.amountCents > 0));
});

// The reviewer's E7 fuzz (round 5), bounded: random baskets over five groups at 20 / 10 / 5,5 %, a discount on 30 % of them.
test('B5-3 fuzz — 4 000 baskets: the folded invoice is never unreachable where the ungrouped solver reached it, VAT per rate = Σ group cuts', () => {
  let seed = 5;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const PRICES = [190, 250, 350, 450, 550, 650, 730, 990, 1400, 1450, 2000, 3500, 4000, 6000];
  const CLASSES = [['drinks', 20], ['catering', 10], ['options', 20], ['resources', 5.5], ['catering', 5.5]];
  let folds = 0;
  for (let n = 0; n < 4000; n += 1) {
    const items = [];
    for (let i = 1 + Math.floor(rnd() * 9); i > 0; i -= 1) {
      const [vatClass, rate] = CLASSES[Math.floor(rnd() * CLASSES.length)];
      items.push({ title: 'x', amountCents: PRICES[Math.floor(rnd() * PRICES.length)], vatRate: rate, vatGroup: `${vatClass}|${rate}` });
    }
    let discount = null;
    if (rnd() < 0.3) {
      const first = items[0];
      const sameGroup = items.filter((i) => i.vatGroup === first.vatGroup).reduce((sum, i) => sum + i.amountCents, 0);
      discount = { title: 'Remise', amountCents: 1 + Math.floor(rnd() * (sameGroup - 1)), vatRate: first.vatRate, vatGroup: first.vatGroup };
    }
    const total = items.reduce((sum, i) => sum + i.amountCents, 0) - (discount ? discount.amountCents : 0);
    const groups = new Map();
    for (const i of items) groups.set(i.vatGroup, (groups.get(i.vatGroup) || 0) + i.amountCents);
    if (discount) groups.set(discount.vatGroup, groups.get(discount.vatGroup) - discount.amountCents);
    const expected = new Map();
    for (const [key, ttc] of groups) {
      const rate = Number(key.split('|')[1]);
      expected.set(rate, (expected.get(rate) || 0) + groupVatCents(ttc, rate));
    }
    const shape = (map) => [...map].map(([rate, vat]) => `${rate}:${vat}`).sort().join();
    const where = `${items.map((i) => `${i.amountCents}@${i.vatGroup}`).join(' ')}${discount ? ` − ${discount.amountCents}` : ''}`;
    const wired = wireItems(items, discount, total);
    assert.ok(wired, `wire unreachable: ${where}`);
    assert.equal(totalOf(wired), total, where);
    assert.equal(shape(vatByRate(wired)), shape(expected), where);
    if (!discount) continue;
    folds += 1;
    const folded = foldedItems(items, discount, total);
    const before = foldedItems(items.map(ungrouped), ungrouped(discount), total);
    if (!folded) {
      assert.equal(before, null, `fold unreachable where the ungrouped solver invoiced: ${where}`);
      continue;
    }
    assert.ok(folded.every((item) => item.amountCents > 0), `a negative line on the fold: ${where}`);
    assert.equal(totalOf(folded), total, where);
    assert.equal(shape(vatByRate(folded)), shape(expected), where);
  }
  assert.ok(folds > 1000, `${folds} folded baskets`);
});
