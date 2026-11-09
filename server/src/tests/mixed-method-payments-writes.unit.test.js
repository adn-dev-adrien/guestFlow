// specs/mixed-method-payments.md §3.4-§3.6 — a split payment recorded through the fiche's endpoints, on a real
// (in-memory) database: the mark and its settlement, the caisse-interne flag (rule 11), the undo that takes the
// settlement with it (rule 13), the reste à percevoir and its collection (rules 16-17), the geste commercial
// (rule 18), the correction (rules 20-25) and what the finance figures read (rule 27).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const controller = require('../controllers/reservationsController');
const settlementsController = require('../controllers/paymentSettlementsController');
const settlementsModel = require('../models/paymentSettlementsModel');
const { comptaCollected, cashCollected, remainingToPay, isSettled } = require('../utils/reservationSettlement');
const { getTodayIsoDate } = require('../utils/reservationHelpers');

const TODAY = getTodayIsoDate();
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

if (!db.prepare('SELECT 1 FROM properties WHERE id = 1').get()) {
  db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (1, 'Gîte', 8, 0)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
}

// A direct stay that left yesterday: acompte and solde paid by link, the end-of-stay cleaning still to collect.
function departedStay({ endOfStay = 122 } = {}) {
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice,
      depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balancePaidDate,
      endOfStayComplementAmount, checkInDone, checkOutDone)
    VALUES (1, 1, ?, ?, 'direct', 2, 720, 216, 1, ?, 504, 1, ?, ?, 1, 1)`)
    .run(addDays(TODAY, -5), addDays(TODAY, -1), addDays(TODAY, -40), addDays(TODAY, -6), endOfStay).lastInsertRowid);
}

// A direct stay to come, nothing paid yet.
function comingStay() {
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice,
      depositAmount, balanceAmount) VALUES (1, 1, ?, ?, 'direct', 2, 700, 200, 500)`)
    .run(addDays(TODAY, 20), addDays(TODAY, 25)).lastInsertRowid);
}

const call = (handler, params, body) => {
  const res = {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  handler({ params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), body, user: { id: 1, role: 'admin' } }, res);
  return res;
};
const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const history = (id) => db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? ORDER BY id").all(id)
  .flatMap((h) => JSON.parse(h.changedFields)).filter((c) => c.field === 'mixedPayment');

const cashIn = (amountCents) => ({ method: 'cash', amountCents, internal: true });
const card = (amountCents) => ({ method: 'card', amountCents });

function payEndOfStay(id, tenders, shortfall) {
  return call(controller.updatePayment, { id }, {
    endOfStayComplementPaid: true, endOfStayComplementPaidDate: TODAY, expectedAmountCents: 12200, tenders, ...(shortfall ? { shortfall } : {}),
  });
}

test('rules 10, 14, 27 — the day\'s cleaning: 50 € cash in the caisse + 72 € card', () => {
  const id = departedStay();
  const res = payEndOfStay(id, [cashIn(5000), card(7200)]);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = row(id);
  assert.equal(r.endOfStayComplementPaid, 1);
  assert.equal(r.endOfStayComplementPaidCash, 0, 'a payment partly on the books stays on the books');
  assert.equal(r.splitOffBooksAmount, 50);
  const [s] = settlementsModel.listFor(id);
  assert.equal(s.targetKind, 'bucket');
  assert.equal(s.targetKey, 'endOfStayComplement');
  assert.deepEqual(s.parts, [{ kind: 'endOfStayComplement', key: 'endOfStayComplement', amountCents: 12200 }]);
  assert.deepEqual(s.tenders.map((t) => [t.method, t.amountCents, t.internal]), [['cash', 5000, 1], ['card', 7200, 0]]);
  // 216 + 504 by link, 72 € of the cleaning on the books; 50 € in the caisse.
  assert.equal(comptaCollected(r), 792);
  assert.equal(cashCollected(r), 50);
  assert.equal(remainingToPay(r), 0);
  assert.equal(isSettled(r), true);
  assert.equal(history(id)[0].to, 'Espèces 50,00 € (caisse interne) · CB 72,00 €');
});

test('rule 6 — lines over the amount due write nothing', () => {
  const id = departedStay();
  const res = payEndOfStay(id, [cashIn(5000), card(8000)]);
  assert.equal(res.statusCode, 400);
  assert.equal(row(id).endOfStayComplementPaid, 0);
  assert.equal(settlementsModel.listFor(id).length, 0);
});

test('rule 15 — lines under the amount due without a choice write nothing', () => {
  const id = departedStay();
  const res = payEndOfStay(id, [cashIn(5000), card(6400)]);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.field, 'shortfall');
  assert.equal(row(id).endOfStayComplementPaid, 0);
});

test('rule 13 — undoing the mark takes the settlement with it', () => {
  const id = departedStay();
  payEndOfStay(id, [cashIn(5000), card(7200)]);
  const res = call(controller.updatePayment, { id }, { endOfStayComplementPaid: false });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(settlementsModel.listFor(id).length, 0);
  assert.equal(row(id).splitOffBooksAmount, 0);
});

test('rule 11 — every line in the caisse: the bucket goes in the caisse whole, as today', () => {
  const id = departedStay();
  payEndOfStay(id, [cashIn(12200)]);
  const r = row(id);
  assert.equal(r.endOfStayComplementPaidCash, 1);
  assert.equal(r.splitOffBooksAmount, 0);
  assert.equal(comptaCollected(r), 720);
  assert.equal(cashCollected(r), 122);
});

test('rules 16-17 — a reste à percevoir keeps the stay open until it is collected', () => {
  const id = departedStay();
  const res = payEndOfStay(id, [cashIn(5000), card(6400)], { kind: 'due' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  let r = row(id);
  assert.equal(r.splitShortfallDue, 8);
  assert.equal(remainingToPay(r), 8);
  assert.equal(isSettled(r), false);
  assert.equal(comptaCollected(r), 784);

  const collected = call(settlementsController.collectRemainder, { id }, {
    targetKind: 'bucket', targetKey: 'endOfStayComplement', date: TODAY, tenders: [cashIn(800)],
  });
  assert.equal(collected.statusCode, 200, JSON.stringify(collected.body));
  r = row(id);
  assert.equal(r.splitShortfallDue, 0);
  assert.equal(isSettled(r), true);
  assert.equal(cashCollected(r), 58);
  assert.equal(comptaCollected(r), 784);
  assert.equal(settlementsModel.listFor(id).length, 2);

  const again = call(settlementsController.collectRemainder, { id }, {
    targetKind: 'bucket', targetKey: 'endOfStayComplement', date: TODAY, tenders: [cashIn(800)],
  });
  assert.equal(again.statusCode, 409, 'nothing left to collect');
});

test('rule 18 — a geste commercial settles the stay and leaves the turnover', () => {
  const id = departedStay();
  payEndOfStay(id, [cashIn(5000), card(6400)], { kind: 'waived' });
  const r = row(id);
  assert.equal(r.splitWaivedAmount, 8);
  assert.equal(isSettled(r), true);
  assert.equal(remainingToPay(r), 0);
  assert.equal(comptaCollected(r), 784);
  assert.equal(cashCollected(r), 50);
});

test('rules 20, 24 — a correction replaces the lines and the history says before and after', () => {
  const id = departedStay();
  payEndOfStay(id, [cashIn(5000), card(7200)]);
  const [s] = settlementsModel.listFor(id);
  const res = call(settlementsController.modify, { id, settlementId: s.id }, { date: TODAY, tenders: [cashIn(4000), card(8200)] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = row(id);
  assert.equal(r.splitOffBooksAmount, 40);
  assert.equal(comptaCollected(r), 802);
  const last = history(id).pop();
  assert.equal(last.from, 'Espèces 50,00 € (caisse interne) · CB 72,00 €');
  assert.equal(last.to, 'Espèces 40,00 € (caisse interne) · CB 82,00 €');
});

test('rule 20 — a correction may turn the payment into a reste à percevoir, and back', () => {
  const id = departedStay();
  payEndOfStay(id, [cashIn(5000), card(7200)]);
  const [s] = settlementsModel.listFor(id);
  const short = call(settlementsController.modify, { id, settlementId: s.id }, { date: TODAY, tenders: [cashIn(5000), card(6400)], shortfall: { kind: 'due' } });
  assert.equal(short.statusCode, 200, JSON.stringify(short.body));
  assert.equal(row(id).splitShortfallDue, 8);
  const whole = call(settlementsController.modify, { id, settlementId: s.id }, { date: TODAY, tenders: [cashIn(5000), card(7200)] });
  assert.equal(whole.statusCode, 200);
  assert.equal(row(id).splitShortfallDue, 0);
});

test('rule 25 — the first payment cannot stop leaving the reste a later payment collected', () => {
  const id = departedStay();
  payEndOfStay(id, [cashIn(5000), card(6400)], { kind: 'due' });
  call(settlementsController.collectRemainder, { id }, { targetKind: 'bucket', targetKey: 'endOfStayComplement', date: TODAY, tenders: [cashIn(800)] });
  const [first] = settlementsModel.listFor(id);
  const res = call(settlementsController.modify, { id, settlementId: first.id }, { date: TODAY, tenders: [cashIn(5000), card(7200)] });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /modifiez-le d'abord/);
});

test('rule 23 — a correction moves the payment date with it; never into the future', () => {
  const id = departedStay();
  payEndOfStay(id, [cashIn(5000), card(7200)]);
  const [s] = settlementsModel.listFor(id);
  const yesterday = addDays(TODAY, -1);
  assert.equal(call(settlementsController.modify, { id, settlementId: s.id }, { date: yesterday, tenders: [cashIn(5000), card(7200)] }).statusCode, 200);
  assert.equal(row(id).endOfStayComplementPaidDate, yesterday);
  const future = call(settlementsController.modify, { id, settlementId: s.id }, { date: addDays(TODAY, 2), tenders: [cashIn(5000), card(7200)] });
  assert.equal(future.statusCode, 400);
});

test('rule 11 — an acompte paid entirely in the caisse gets its caisse-interne flag', () => {
  const id = comingStay();
  const res = call(controller.updatePayment, { id }, { depositPaid: true, depositPaidDate: TODAY, expectedAmountCents: 20000, tenders: [cashIn(20000)] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(row(id).depositPaidCash, 1);
});

test('rule 2 — a platform payout is never split', () => {
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice, balanceAmount)
    VALUES (1, 1, ?, ?, 'Booking', 2, 500, 500)`).run(addDays(TODAY, 10), addDays(TODAY, 12)).lastInsertRowid);
  const res = call(controller.updatePayment, { id }, { balancePaid: true, balancePaidDate: TODAY, expectedAmountCents: 50000, tenders: [card(50000)] });
  assert.equal(res.statusCode, 400);
});

test('rule 1 — one payment at a time', () => {
  const id = comingStay();
  const res = call(controller.updatePayment, { id }, { depositPaid: true, balancePaid: true, expectedAmountCents: 70000, tenders: [card(70000)] });
  assert.equal(res.statusCode, 400);
});

test('rules 1, 10 — the single arrival payment with several methods records one settlement on the group', () => {
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice,
      depositAmount, balanceAmount, complementAmount, checkInDone)
    VALUES (1, 1, ?, ?, 'direct', 2, 700, 200, 500, 40, 1)`).run(TODAY, addDays(TODAY, 3)).lastInsertRowid);
  const res = call(controller.settleArrivalPayment, { id }, {
    mode: 'split', date: TODAY, expectedAmountCents: 74000, tenders: [cashIn(4000), card(70000)],
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [s] = settlementsModel.listFor(id);
  assert.equal(s.targetKind, 'arrivalGroup');
  assert.equal(s.parts.reduce((t, p) => t + p.amountCents, 0), 74000);
  assert.equal(row(id).splitOffBooksAmount, 40);
  // The réduction of the single payment is the settlement's geste commercial now.
  assert.equal(call(controller.settleArrivalPayment, { id }, { mode: 'adjust', total: 700 }).statusCode, 409);
  // Undoing the single payment takes its settlement with it.
  assert.equal(call(controller.settleArrivalPayment, { id }, { mode: 'undo' }).statusCode, 200);
  assert.equal(settlementsModel.listFor(id).length, 0);
});
