// specs/pricing/pricing-components.md §3 rules 31, 103 (stabilisation loop t4, S4-6, 2026-11-16) — the discount of an arrival line given back once the arrival
// is validated is carved out to the departure: « Ventes du séjour — au départ » lists that part (`departureCents` of the line), the arrival lists the
// rest, and the arrival baseline stays where the arrival collected the line, so a later sale keeps the part at the departure. Before: the section
// left the 10 € out, and a baseline raised at a validated arrival let the next save drop them from every bucket.
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
const tick = (id, now) => withNow(now, () => {
  let status = 200;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  controller.updatePayment({ params: { id: String(id) }, body: { checkInDone: true }, query: {}, user: { id: 1, role: 'admin' } }, res);
  return status;
});
const section = (id, now) => (extraSale.departureSalesOf(id, now) || { lines: [] }).lines.map((l) => [l.label, l.totalCents]);

test('S4-6 — discounted before the arrival, given back once validated: the departure lists the 10 €, the arrival the rest', () => {
  const id = stay(20);
  const base = unabsorbed(id);
  const sold = extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }], { now: at(id, '12:00', -3) });
  const ref = sold.saleDetail.lines.find((l) => l.label === 'Panier du terroir').ref;
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 10 } }, { now: at(id, '12:00', -3) }).status, 200);
  const now = at(id, '18:00');
  assert.equal(tick(id, now), 200);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now }).status, 200);
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 0 } }, { now }).status, 200);
  assert.deepEqual([c(row(id).complementAmount), c(row(id).endOfStayComplementAmount)], [3500, 1600]);
  const line = extraSale.saleDetailOf(id, now).lines.find((l) => l.ref === ref);
  assert.deepEqual([line.collectAt, line.totalCents, line.departureCents], ['arrival', 4500, 1000]);
  assert.deepEqual(section(id, now).find(([label]) => label === 'Panier du terroir'), ['Panier du terroir', 1000]);
  assert.equal(unabsorbed(id), base);
});

test('S4-6 — a departure line moved to a validated arrival, its discount given back: the 10 € stay at the departure after the next sale', () => {
  const id = stay(20);
  const base = unabsorbed(id);
  const now = at(id, '18:00');
  assert.equal(tick(id, now), 200);
  const sold = extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }], { now });
  const ref = sold.saleDetail.lines.find((l) => l.label === 'Panier du terroir').ref;
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 10 } }, { now }).status, 200);
  assert.equal(extraSale.changeLine(id, ref, { collectAt: 'arrival' }, { now }).status, 200);
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 0 } }, { now }).status, 200);
  assert.equal(c(row(id).endOfStayComplementAmount), 1000);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now }).status, 200);
  assert.deepEqual([c(row(id).complementAmount), c(row(id).endOfStayComplementAmount)], [3500, 1600]);
  assert.equal(unabsorbed(id), base);
});
