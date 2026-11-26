// specs/pricing/pricing-components.md §3 rules 104, 106-112 (stabilisation loop t7, B7-1..B7-3) — the stay's money conservation over random sequences of what a
// stay's notes live through: notes paid by card or in cash, unpaid lines sold, paid lines offered (the trop-perçu confirmed), the trop-perçu refunded
// the way the fiche proposes it (the cash part « Caisse interne » first, then the rest by its means, on the postes the server split), a refund deleted.
// After EVERY step:
//   1. no cent is created or lost: Σ buckets + notes − still owed − refunded = the stay's total (price + tax), what is still asked included;
//   2. the books never reverse more than they received: the booked refund allocations ≤ the booked (card) note money;
//   3. a refund of note money is booked on the prestations, never on the accommodation.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');

const plank = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Planche fuzz', 20, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) SELECT propertyId, ? FROM property_options WHERE optionId = ? LIMIT 1').run(plank, beer);
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refunds = require('../controllers/refundsController');
const { storedBody } = require('../utils/stayOrderLines');

const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const call = (handler, params, body) => { const res = respond(); handler({ params, body, query: {}, user: { id: 1, role: 'admin' } }, res); return res; };
const cents = (v) => Math.round(Number(v || 0) * 100);
const notes = (id) => JSON.parse(row(id).midStaySettledNotes || '[]');
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
const refunded = (id) => cents(db.prepare('SELECT COALESCE(SUM(totalTtc), 0) AS t FROM reservation_refunds WHERE reservationId = ?').get(id).t);
const imbalance = (id) => {
  const r = row(id);
  return cents(r.depositAmount) + cents(r.balanceAmount) + cents(r.complementAmount) + cents(r.endOfStayComplementAmount)
    + notes(id).reduce((sum, note) => sum + cents(note.total), 0) - owed(id) - refunded(id) - cents(r.finalPrice) - cents(r.touristTaxTotal);
};
const bookedRefundCents = (id) => -Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM payment_allocations WHERE documentRef = ? AND kind = 'refund' AND books = 1")
  .get(`reservation:${id}`).c);
const bookedNoteCents = (id) => notes(id).filter((note) => Number(note.paidCash || 0) !== 1).reduce((sum, note) => sum + cents(note.total), 0);
const accommodationRefundLines = (id) => Number(db.prepare(`SELECT COUNT(*) AS n FROM reservation_refund_lines l JOIN reservation_refunds r ON r.id = l.refundId
  WHERE r.reservationId = ? AND l.bucket = 'accommodation'`).get(id).n);

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

function refundTheWayProposed(id) {
  const over = ctrl.storedOverpayment(id);
  if (!over || !(over.overpaymentTtc > 0)) return 'none';
  const part = over.overpaymentCash;
  const lines = (part ? part.lines : over.overpaymentLines).map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc }));
  const method = part ? 'internal' : (over.overpaymentMethod || 'transfer');
  const made = call(refunds.create, { id: String(id) }, { refundDate: todayIso(), method, reason: 'Trop-perçu', fromOverpayment: true, overpaymentTtc: over.overpaymentTtc, lines });
  assert.equal(made.statusCode, 201, JSON.stringify(made.body));
  return `${method}:${made.body.refund.id}`;
}

function sequence(seed, steps) {
  const next = rng(seed);
  const platform = next() < 0.5 ? 'direct' : 'Booking';
  const id = stay(20);
  db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
  call(ctrl.updatePayment, { id: String(id) }, { balancePaid: true, balancePaidDate: todayIso() });
  call(ctrl.updatePayment, { id: String(id) }, { checkInDone: true });
  const day = addDaysToIsoDate(row(id).startDate, 1);
  let minute = 0;
  const now = () => { minute += 1; return new Date(`${day}T${String(9 + Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`); };
  const madeRefunds = [];
  const trace = [];
  for (let step = 0; step < steps; step += 1) {
    const roll = next();
    let did;
    if (roll < 0.3) {
      const payment = next() < 0.5 ? 'cash' : 'card';
      const article = next() < 0.5 ? beer : plank;
      did = `sell ${article === beer ? 'beer' : 'plank'} ${payment} ${extraSale.sell(id, [{ articleRef: `option:${article}`, quantity: 1 }], { now: now(), payment }).status}`;
    } else if (roll < 0.45) {
      did = `sell unpaid ${extraSale.sell(id, [{ articleRef: `option:${plank}`, quantity: 1 }], { now: now() }).status}`;
    } else if (roll < 0.7) {
      const paid = extraSale.saleDetailOf(id, now()).lines.filter((l) => /^option:/.test(l.articleKey) && !l.offered && l.totalCents > 0);
      const line = paid[Math.floor(next() * paid.length)];
      did = line ? `offer ${line.label} ${extraSale.changeLine(id, line.ref, { offered: true }, { now: now(), forceOverpayment: true }).status}` : 'offer none';
    } else if (roll < 0.92) {
      const made = refundTheWayProposed(id);
      if (made !== 'none') madeRefunds.push(Number(made.split(':')[1]));
      did = `refund ${made}`;
    } else {
      const refundId = madeRefunds.pop();
      if (refundId) {
        const gone = respond();
        refunds.remove({ params: { id: String(id), refundId: String(refundId) }, query: {}, user: { id: 1, role: 'admin' } }, gone);
        did = `delete refund ${refundId} ${gone.statusCode}`;
      } else did = 'delete none';
    }
    trace.push(did);
    const where = `seed ${seed} ${platform} step ${step}: ${trace.join(' | ')}`;
    assert.equal(imbalance(id), 0, `money created or lost — ${where}`);
    assert.ok(bookedRefundCents(id) <= bookedNoteCents(id), `the books reverse more than they received — ${where}`);
    assert.equal(accommodationRefundLines(id), 0, `note money refunded on the accommodation — ${where}`);
  }
}

for (const seed of [7101, 7102, 7103, 7104, 7105, 7106]) {
  test(`B7-1..B7-3 — stay note money conservation, seed ${seed}`, () => sequence(seed, 12));
}
