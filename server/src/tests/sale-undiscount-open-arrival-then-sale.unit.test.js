// specs/pricing/pricing-components.md §3 rule 103 d (stabilisation loop t4, S4-1, 2026-11-16) — at the open arrival, a discount set then removed leaves the
// arrival baseline at the line's whole worth (`fitArrivalBaseline`, D4-1): ticked and followed by a sale, the departure takes only that sale. Before:
// the baseline stayed at the discounted net, the departure billed the given-back 10 € a second time (Σ buckets + 10 €).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stay, row, beer, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const controller = require('../controllers/reservationsController');
const { withNow } = require('../utils/localDate');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const c = (v) => Math.round(Number(v || 0) * 100);
const unabsorbed = (id) => { const r = row(id); return c(r.depositAmount) + c(r.balanceAmount) + c(r.complementAmount) + c(r.endOfStayComplementAmount) - c(r.finalPrice) - c(r.touristTaxTotal); };

test('S4-1 — open arrival: discount 10 then 0, ticked, a 6 € sale: the departure takes 6 €, Σ unchanged', () => {
  const id = stay(20);
  const sold = extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }], { now: at(id, '12:00', -3) });
  const ref = sold.saleDetail.lines.find((l) => l.label === 'Panier du terroir').ref;
  const now = at(id, '18:00');
  const before = unabsorbed(id);
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 10 } }, { now }).status, 200);
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 0 } }, { now }).status, 200);
  withNow(now, () => controller.updatePayment({ params: { id: String(id) }, body: { checkInDone: true }, query: {}, user: { id: 1, role: 'admin' } },
    { status() { return this; }, json() { return this; } }));
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now }).status, 200);
  assert.deepEqual([c(row(id).complementAmount), c(row(id).endOfStayComplementAmount)], [4500, 600]);
  assert.equal(unabsorbed(id), before);
});
