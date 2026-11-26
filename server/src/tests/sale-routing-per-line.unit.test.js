// specs/pricing/pricing-components.md §3 rules 79 / 85 (stabilisation loop t9, B9-5, 2026-11-16) — inside the mid-stay window every body line keeps ITS
// OWN stored routing (specs/sas/mid-stay-extras-on-locked-fiche.md rule 8), addressed by `lineId`. A stay holding two lines of one article — the
// beer paid in the solde (`inComplement` 0) and the same beer sold again before the arrival (arrival complement, `inComplement` 1) — never
// shares one pin between them. Before, the routing was keyed by the article: the last row won for both, the solde's paid beer moved to the
// complement and the end-of-stay complement asked its 30 € again.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');

const plank = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Planche routage', 20, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9701, ?)').run(plank);
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');

const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const pay = (id, body) => { const res = respond(); ctrl.updatePayment({ params: { id: String(id) }, body, query: {}, user: { id: 1, role: 'admin' } }, res); assert.equal(res.statusCode, 200, JSON.stringify(res.body)); };
const cents = (v) => Math.round(Number(v || 0) * 100);
const lines = (id) => db.prepare('SELECT lineId, optionId, totalPrice, inComplement, collectAt FROM reservation_options WHERE reservationId = ? ORDER BY lineId').all(id);
const received = (id) => { const r = row(id); return cents(r.balanceAmount) + (r.complementPaid ? cents(r.complementAmount) : 0); };

// Solde (accommodation 300 + beer ×5 30) paid; one beer (6) sold unpaid three days before the arrival, its complement collected; checked in.
function soldeBeerAndArrivalBeer() {
  const id = stay(20);
  const body = storedBody(id);
  assert.equal(ctrl.performUpdate(id, { ...body, options: [...body.options, { optionId: beer, quantity: 5 }], restatePricing: true }).status, 200);
  pay(id, { balancePaid: true, balancePaidDate: todayIso() });
  const at = (day, t) => new Date(`${addDaysToIsoDate(row(id).startDate, day)}T${t}:00`);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now: at(-3, '10:00') }).status, 200);
  pay(id, { complementPaid: true, complementPaidDate: todayIso() });
  pay(id, { checkInDone: true });
  assert.deepEqual(lines(id).map((l) => [l.totalPrice, l.inComplement, l.collectAt]), [[30, 0, null], [6, 1, 'arrival']]);
  return { id, at };
}

const assertNothingAskedTwice = (id, dueAtDeparture) => {
  const [solde, arrival] = lines(id);
  assert.deepEqual([solde.inComplement, solde.collectAt], [0, null], 'the solde\'s paid beer stays in the solde');
  assert.deepEqual([arrival.inComplement, arrival.collectAt], [1, 'arrival'], 'the arrival beer stays in the collected arrival complement');
  const r = row(id);
  assert.equal(cents(r.endOfStayComplementAmount), dueAtDeparture, 'the end-of-stay complement asks the new line only');
  assert.equal(received(id) + cents(r.endOfStayComplementAmount), cents(r.finalPrice) + cents(r.touristTaxTotal), 'received + asked = total');
};

test('B9-5: a sale in the stay keeps each line of one article on its own routing (the solde beer is never asked again)', () => {
  const { id, at } = soldeBeerAndArrivalBeer();
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${plank}`, quantity: 1 }], { now: at(1, '10:00') }).status, 200);
  assertNothingAskedTwice(id, 2000);
  const detail = extraSale.saleDetailOf(id, at(1, '11:00')).lines.filter((l) => l.articleKey === `option:${beer}`).map((l) => [l.totalCents, l.status]);
  assert.deepEqual(detail, [[3000, 'paid'], [600, 'dueAtArrival']]);
});

test('B9-5: a no-change fiche save in the stay moves no line of the article', () => {
  const { id, at } = soldeBeerAndArrivalBeer();
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${plank}`, quantity: 1 }], { now: at(1, '10:00') }).status, 200);
  const saved = ctrl.performUpdate(id, storedBody(id), { now: at(1, '12:00') });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assertNothingAskedTwice(id, 2000);
});
