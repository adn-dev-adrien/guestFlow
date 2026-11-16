// specs/outside-booking-sas.md rule 56 (e) (stabilisation loop t4 B4-4) and specs/pricing-components.md rule 62 — Qonto computes the VAT line by line; a sale
// document's items name their (class, rate) group, and the issuer sends each group's items so that Qonto's VAT for the group is the VAT the journal cuts ONCE
// on the group's TTC (`groupVatCents`), the TTC unchanged. Items that name no group (a stay, a booking paid on its own) are sent exactly as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const { wireItems, foldedItems, ttcOf } = require('../invoiceIssuer');
const { groupVatCents } = require('../../../utils/pricing/vat');

const sent = (wired, rate) => ({
  ht: wired.reduce((sum, item) => sum + item.amountCents, 0),
  ttc: wired.reduce((sum, item) => sum + ttcOf(item.amountCents, rate), 0),
});
const group = (amounts, rate, key = `drinks|${rate}`) => amounts.map((amountCents) => ({ title: 'Bière', amountCents, vatRate: rate, vatGroup: key }));

test('B4-4 — two beers at 6,50 € (20 %): Qonto states 2,17 € of VAT like the journal, not 2,16 €; the group key never reaches the wire', () => {
  const wired = wireItems(group([650, 650], 20), null, 1300);
  assert.deepEqual(sent(wired, 20), { ht: 1083, ttc: 1300 });
  assert.equal(groupVatCents(1300, 20), 217);
  assert.ok(wired.every((item) => !('vatGroup' in item)));
});

test('B4-4 — the reviewer\'s baskets: Qonto VAT = journal VAT, Qonto total = the TTC', () => {
  for (const [amounts, rate] of [[[1400, 1400, 1400], 20], [[650, 650, 650, 650, 650, 650, 650], 20], [[450, 450, 450, 450, 450], 5.5], [[350, 350, 350], 10], [[550, 550, 550], 5.5]]) {
    const ttc = amounts.reduce((sum, c) => sum + c, 0);
    const out = sent(wireItems(group(amounts, rate), null, ttc), rate);
    assert.deepEqual([out.ttc, out.ttc - out.ht], [ttc, groupVatCents(ttc, rate)], `${amounts.join('+')} @ ${rate}`);
  }
});

test('B4-4 — several groups: each group reaches its own cut; a fuzz of 3 000 baskets at 20 %, 10 % and 5,5 % never misses', () => {
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let k = 0; k < 3000; k += 1) {
    const items = [];
    for (const rate of [20, 10, 5.5]) {
      const count = Math.floor(rnd() * 5);
      for (let i = 0; i < count; i += 1) items.push({ title: 'x', amountCents: 50 + Math.floor(rnd() * 4000), vatRate: rate, vatGroup: `c|${rate}` });
    }
    if (!items.length) continue;
    const total = items.reduce((sum, item) => sum + item.amountCents, 0);
    const wired = wireItems(items, null, total);
    assert.ok(wired, `reachable: ${JSON.stringify(items)}`);
    for (const rate of [20, 10, 5.5]) {
      const ttc = items.filter((item) => item.vatRate === rate).reduce((sum, item) => sum + item.amountCents, 0);
      const out = sent(wired.filter((item) => item.vatRate === rate), rate);
      assert.deepEqual([out.ttc, out.ttc - out.ht], [ttc, groupVatCents(ttc, rate)]);
    }
  }
});

test('B4-4 — a discount in the session\'s group is cut with it; folded, it stays in its group', () => {
  const items = [{ title: 'Séance · Jour', amountCents: 5000, vatRate: 20, vatGroup: 'resources|20' }, { title: 'Séance · Soir', amountCents: 7000, vatRate: 20, vatGroup: 'resources|20' },
    { title: 'Bière', amountCents: 650, vatRate: 20, vatGroup: 'drinks|20' }, { title: 'Bière', amountCents: 650, vatRate: 20, vatGroup: 'drinks|20' }];
  const discount = { title: 'Temps offert', amountCents: 1250, vatRate: 20, vatGroup: 'resources|20' };
  const wired = wireItems(items, discount, 12050);
  const session = sent(wired.filter((item) => item.title !== 'Bière'), 20);
  assert.deepEqual([session.ttc, session.ttc - session.ht], [10750, groupVatCents(10750, 20)]);
  const folded = foldedItems(items, discount, 12050);
  assert.deepEqual(folded.filter((item) => item.title === 'Bière').map((item) => ttcOf(item.amountCents, 20)).reduce((a, b) => a + b, 0), 1300, 'the beers are not folded');
});

test('items with no group (a stay, a booking) are solved on the total only, as before', () => {
  const items = [{ title: 'Bière', amountCents: 650, vatRate: 20 }, { title: 'Bière', amountCents: 650, vatRate: 20 }];
  assert.deepEqual(sent(wireItems(items, null, 1300), 20), { ht: 1084, ttc: 1300 });
});
