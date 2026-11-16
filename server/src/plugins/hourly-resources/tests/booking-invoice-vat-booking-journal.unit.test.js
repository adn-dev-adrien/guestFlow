// specs/pricing-components.md rule 62, specs/outside-booking-sas.md rules 56 (e), 57 (b) and specs/resource-booking-pricing-and-invoicing.md rules 14, 53 (stabilisation
// loop t5 B5-2) — the journal books a booking sold outside a stay as ONE line whose HT is the net of its TTC (`netOfTtc`, net first). The Qonto invoice of
// the booking states that VAT: its items and its discount name the `booking:` group, and the issuer sends a `booking:` group with the booking journal's
// cut — on its own invoice, and as the session paid on the booking inside a visit's document. Before, Qonto's per-line VAT drifted a cent (20 € − 15 € at
// 10 % → 0,46 against the books' 0,45), and a document's `booking:` group took the sale cut (10,05 € at 20 % → 1,68 against 1,67).
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, book, card } = require('./standaloneBookingFixture');
const { createInvoicing } = require('../invoicing');
const { optionalPlugin, skipWithout } = require('../../sdk/testing');
// The issuer lives in online-payment: without it there is no Qonto invoice to judge.
const { wireItems, foldedItems, ttcOf } = optionalPlugin(() => require('../../online-payment/invoiceIssuer'));
const NEEDS_ISSUER = { skip: skipWithout(['online-payment']) };
const { netOfTtc } = require('../../../utils/accounting/legacyBucketSplit');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

const vatOfWire = (wired) => wired.reduce((sum, item) => sum + ttcOf(item.amountCents, item.vatRate) - item.amountCents, 0);
const totalOfWire = (wired) => wired.reduce((sum, item) => sum + ttcOf(item.amountCents, item.vatRate), 0);
// What the booking's journal entry books as VAT on a TTC (`journalLines.standaloneLines`).
const journalVat = (ttcCents, rate) => ttcCents - Math.round(netOfTtc(ttcCents / 100, rate) * 100);
const session = (rate, amounts, deduction) => ({
  items: amounts.map((amountCents) => ({ title: 'Bain · séance', amountCents, vatRate: rate, vatGroup: `booking:session|${rate}` })),
  discount: deduction ? { title: '1 h offerte', amountCents: deduction, vatRate: rate, vatGroup: `booking:session|${rate}` } : null,
});

test('B5-2 — 20 € − 15 € « 1 h offerte » at 10 %: Qonto states 0,45 € of VAT, the booking journal\'s', NEEDS_ISSUER, () => {
  const { items, discount } = session(10, [2000], 1500);
  const wired = wireItems(items, discount, 500);
  assert.equal(totalOfWire(wired), 500);
  assert.equal(vatOfWire(wired), 45);
  assert.equal(journalVat(500, 10), 45);
  assert.ok(wired.every((item) => !('vatGroup' in item)));
});

test('B5-2 — a document\'s session paid on the booking (10,05 € at 20 %) takes the booking journal\'s cut, not the sale cut', NEEDS_ISSUER, () => {
  const items = [
    { title: 'Bain · séance', amountCents: 1005, vatRate: 20, vatGroup: 'booking:resources|20' },
    { title: 'Bière', amountCents: 1005, vatRate: 20, vatGroup: 'drinks|20' },
  ];
  const wired = wireItems(items, null, 2010);
  const sessionPart = wired.slice(0, wired.findIndex((item) => item.title === 'Bière'));
  const salePart = wired.slice(sessionPart.length);
  assert.equal(totalOfWire(sessionPart), 1005);
  assert.equal(vatOfWire(sessionPart), journalVat(1005, 20));
  assert.equal(journalVat(1005, 20), 167);
  assert.equal(totalOfWire(salePart), 1005);
  assert.equal(vatOfWire(salePart), 168, 'a sale line keeps the sale cut');
});

test('B5-2 — the booking-only request names the booking group: what the issuer sends is the journal\'s VAT', NEEDS_ISSUER, async () => {
  for (const vatRate of [20, 10, 5.5]) {
    const { model, resourceId } = seed({ vatRate });
    let request = null;
    const issuer = {
      id: 'fake',
      isReady: () => true,
      async issue(r) { request = r; return { invoiceId: 'inv-1', number: `F-${Y}-0001`, totalCents: r.expectedTotalCents, clientId: 'cli-1', markedPaid: true }; },
      async findCardBatch() { return null; },
      async attach() { return { attachmentId: 'att-1' }; },
      async invoiceStatus() { return 'paid'; },
    };
    const invoicing = createInvoicing({ bookings: () => model, issuers: () => issuer, logger: { error() {}, warn() {} } });
    const id = book(model, resourceId, { offeredMinutes: 30, billing: { street: '3 rue des Lilas', postcode: '07000', city: 'Privas' } });
    model.recordPayment(id, { tenders: card(9500), paidAt: `${Y}-11-09` });
    assert.equal((await invoicing.issue(id)).ok, true);
    assert.ok(request.items.every((item) => item.vatGroup === `booking:session|${vatRate}`));
    assert.equal(request.discount.vatGroup, `booking:session|${vatRate}`);
    const wired = wireItems(request.items, request.discount, request.expectedTotalCents);
    assert.equal(totalOfWire(wired), request.expectedTotalCents);
    assert.equal(vatOfWire(wired), journalVat(request.expectedTotalCents, vatRate), `at ${vatRate} %`);
  }
});

// The reviewer's sweep of round 5: realistic breakdowns of a session (20-60 €), an extra part (0-20 €) and a deduction (0-30 €) at 10 / 20 / 5,5 %.
test('B5-2 sweep — every breakdown states the booking journal\'s VAT, on the wire and on the folded fallback; the ungrouped solver missed some', NEEDS_ISSUER, () => {
  let missedBefore = 0;
  let checked = 0;
  for (const rate of [10, 20, 5.5]) {
    for (let sessionCents = 2000; sessionCents <= 6000; sessionCents += 500) {
      for (let extraCents = 0; extraCents <= 2000; extraCents += 250) {
        for (let deduction = 0; deduction <= 3000; deduction += 750) {
          const amounts = extraCents ? [sessionCents, extraCents] : [sessionCents];
          const total = sessionCents + extraCents - deduction;
          if (total <= 0) continue;
          const { items, discount } = session(rate, amounts, deduction);
          const where = `${amounts.join('+')} − ${deduction} @ ${rate}`;
          const wired = wireItems(items, discount, total);
          assert.ok(wired, `unreachable: ${where}`);
          assert.equal(totalOfWire(wired), total, where);
          assert.equal(vatOfWire(wired), journalVat(total, rate), where);
          if (discount) {
            const folded = foldedItems(items, discount, total);
            assert.ok(folded, `fold unreachable: ${where}`);
            assert.equal(totalOfWire(folded), total, where);
            assert.equal(vatOfWire(folded), journalVat(total, rate), where);
          }
          const strip = ({ vatGroup, ...rest }) => rest;
          const before = wireItems(items.map(strip), discount && strip(discount), total);
          if (vatOfWire(before) !== journalVat(total, rate)) missedBefore += 1;
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 1000, `${checked} breakdowns`);
  assert.ok(missedBefore > 0, `the ungrouped solver missed ${missedBefore} — the sweep reaches the defect`);
});
