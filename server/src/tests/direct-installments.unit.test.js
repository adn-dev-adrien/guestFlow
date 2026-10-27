// specs/direct-installments.md §3 — the rules of the installment plan: the euro split, the default dates,
// the recompute before and after the first payment, the pinned amounts, the statuses, eligibility and the
// date validation. The pure rules first, then the controller on an in-memory database.
const test = require('node:test');
const assert = require('node:assert/strict');

const plan = require('../utils/installmentPlan');
const { setDirectChannels } = require('../utils/platformNameFormat');
const { daysBetween } = require('../utils/paymentSchedule');
const { TODAY, ARRIVAL, createHarness, call, addStay } = require('./directInstallmentsFixtures');

const CONTEXT = { today: TODAY, startDate: ARRIVAL, balanceDaysBefore: 30 };
const row = (number, amountCents, extra = {}) => ({ number, amountCents, paid: 0, amountEdited: 0, dueDate: '2027-01-01', ...extra });
const amountsOf = (result) => [...result.amounts.values()];

// ── Rule 6 — the euro split ─────────────────────────────────────────────────────────────────────────
test('rule 6 — 1 001,50 € in 3: 334 + 334 + 333,50, the last carries the cents', () => {
  assert.deepEqual(plan.splitEuros(100150, 3), [33400, 33400, 33350]);
});

test('rule 6 — 1 000 € in 3: 333 + 333 + 334, the last absorbs the rounding', () => {
  assert.deepEqual(plan.splitEuros(100000, 3), [33300, 33300, 33400]);
});

test('rule 6 — a total below N euros is refused rather than split into 0 € shares', () => {
  assert.equal(plan.splitEuros(250, 3), null);
  assert.equal(plan.splitEuros(300, 3).length, 3);
});

// ── Rule 10 and rule 3 — dates and room ─────────────────────────────────────────────────────────────
test('rule 10 — first today, last at the usual solde date, the others evenly spaced', () => {
  const dates = plan.defaultDates(CONTEXT, 3);
  assert.equal(dates[0], TODAY);
  assert.equal(dates[2], '2027-05-15', 'J-30 before 14/06/2027');
  assert.equal(daysBetween(dates[0], dates[1]), 100);
  assert.equal(daysBetween(dates[1], dates[2]), 100);
});

test('rule 10 — a stay closer than the solde delay puts the last installment on today', () => {
  const context = { ...CONTEXT, startDate: '2026-11-10' };
  assert.equal(plan.lastDueDate(context), TODAY);
  assert.equal(plan.maxCountFor(context), 1, 'one day, one installment: no plan');
});

test('rule 3 — never more installments than days between the first and the last, nor more than 12', () => {
  assert.equal(plan.maxCountFor(CONTEXT), 12);
  const tight = { ...CONTEXT, startDate: '2026-11-04', balanceDaysBefore: 0 };
  assert.equal(plan.maxCountFor(tight), 9, '27/10 to 04/11 holds 9 days, the first and the last included');
  const dates = plan.defaultDates({ ...tight, startDate: '2026-10-30' }, 4);
  assert.deepEqual(dates, ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'], 'a day each, no two on the same day');
});

// ── Rules 7, 8, 9 — recompute, then frozen ──────────────────────────────────────────────────────────
test('rule 7 — before any payment every recalculation recomputes all the amounts', () => {
  const rows = [row(1, 33400), row(2, 33400), row(3, 33350)];
  const result = plan.rebalance({ installments: rows, targetCents: 109150 });
  assert.deepEqual(amountsOf(result), [36400, 36400, 36350]);
  assert.equal(result.gapCents, 0);
  assert.equal(result.frozen, false);
});

test('rule 8 — a rise after the first payment is spread over the unpaid installments, the last takes the remainder', () => {
  const rows = [row(1, 33400, { paid: 1 }), row(2, 33400), row(3, 33350)];
  const result = plan.rebalance({ installments: rows, targetCents: 110150 });
  assert.deepEqual(amountsOf(result), [33400, 33400 + 5000, 33350 + 5000]);
  assert.deepEqual([...result.added.entries()], [[2, 5000], [3, 5000]]);
  assert.equal(result.frozen, true);
});

test('rule 8 — a drop after the first payment changes nothing and is reported as a gap', () => {
  const rows = [row(1, 33400, { paid: 1 }), row(2, 33400), row(3, 33350)];
  const result = plan.rebalance({ installments: rows, targetCents: 97650 });
  assert.deepEqual(amountsOf(result), [33400, 33400, 33350]);
  assert.equal(result.gapCents, 2500);
});

test('rule 8 — a rise after a drop first absorbs the gap: only the excess is added', () => {
  const rows = [row(1, 33400, { paid: 1 }), row(2, 33400), row(3, 33350)];
  const afterRise = plan.rebalance({ installments: rows, targetCents: 102650 });
  assert.equal(afterRise.gapCents, 0);
  assert.deepEqual(amountsOf(afterRise), [33400, 33400 + 1300, 33350 + 1200], 'Δ is 25 € against the total, not 52,50 €');
});

test('rule 8 — every installment paid: the plan does not move, the rise belongs to the arrival complement', () => {
  const rows = [row(1, 50000, { paid: 1 }), row(2, 50150, { paid: 1 })];
  const result = plan.rebalance({ installments: rows, targetCents: 110150 });
  assert.deepEqual(amountsOf(result), [50000, 50150]);
  assert.equal(result.gapCents, 0);
});

test('rule 9 — a paid installment never changes amount', () => {
  const rows = [row(1, 33400, { paid: 1 }), row(2, 33400, { paid: 1 }), row(3, 33350)];
  const result = plan.rebalance({ installments: rows, targetCents: 150000 });
  assert.deepEqual(amountsOf(result), [33400, 33400, 83200], 'the whole rise lands on the only unpaid installment');
});

// ── Rule 9a — amounts typed by hand ─────────────────────────────────────────────────────────────────
test('rule 9a — a typed amount is accepted and the rest is spread over the others, the last adjusting', () => {
  const rows = [row(1, 33400), row(2, 33400), row(3, 33350)];
  const checked = plan.validateAmount({ installments: rows, index: 0, amountEuros: 500, targetCents: 100150 });
  assert.equal(checked.cents, 50000);
  assert.deepEqual(plan.spreadCents(checked.rest, checked.others.length), [25100, 25050]);
});

test('rule 9a — refused: not whole euros, zero, the last unpaid, or no euro left for the others', () => {
  const rows = [row(1, 33400), row(2, 33400), row(3, 33350)];
  const refuse = (index, amountEuros) => plan.validateAmount({ installments: rows, index, amountEuros, targetCents: 100150 }).error;
  assert.match(refuse(0, 250.5), /euros entiers/);
  assert.match(refuse(0, 0), /euros entiers/);
  assert.match(refuse(0, ''), /euros entiers/);
  assert.match(refuse(2, 100), /dernière échéance/);
  assert.equal(refuse(0, 1000), "Laisse moins de 1 € à l'échéance 3.");
  assert.equal(refuse(0, 999), undefined, '2 € are left for two installments: 1 € each');
});

test('rule 9a — a pinned amount survives a recompute; the rest follows; a pin leaving no room is released', () => {
  const rows = [row(1, 50000, { amountEdited: 1 }), row(2, 25000), row(3, 25150)];
  const result = plan.rebalance({ installments: rows, targetCents: 109150 });
  assert.deepEqual(amountsOf(result), [50000, 29600, 29550]);
  const starved = plan.rebalance({ installments: rows, targetCents: 50100 });
  assert.equal(starved.clearPins, true, 'nothing would be left for the others');
  assert.equal(amountsOf(starved).reduce((a, b) => a + b, 0), 50100);
});

test('rule 9a — a rise after the first payment skips the pinned installment', () => {
  const rows = [row(1, 20000, { paid: 1 }), row(2, 30000, { amountEdited: 1 }), row(3, 20000), row(4, 30150)];
  const result = plan.rebalance({ installments: rows, targetCents: 110150 });
  assert.deepEqual(amountsOf(result), [20000, 30000, 25000, 35150]);
});

// ── Rule 14 — statuses ──────────────────────────────────────────────────────────────────────────────
test('rule 14 — upcoming, to request, requested, paid, and late three days after the due date', () => {
  const at = (extra) => plan.statusOf({ dueDate: '2026-11-10', paid: 0, requestedAt: null, ...extra }, '2026-11-10');
  assert.equal(plan.statusOf({ dueDate: '2026-11-10', paid: 0 }, '2026-11-09'), 'upcoming');
  assert.equal(at({}), 'toRequest');
  assert.equal(at({ requestedAt: '2026-11-10T08:00:00Z' }), 'requested');
  assert.equal(at({ paid: 1 }), 'paid');
  assert.equal(plan.statusOf({ dueDate: '2026-11-10', paid: 0, requestedAt: 'x' }, '2026-11-12'), 'requested');
  assert.equal(plan.statusOf({ dueDate: '2026-11-10', paid: 0, requestedAt: 'x' }, '2026-11-13'), 'late');
  assert.equal(plan.statusOf({ dueDate: '2026-11-10', paid: 0 }, '2026-11-13'), 'late', 'late wins over « à demander »');
  assert.equal(plan.statusOf({ dueDate: '2026-11-10', paid: 1 }, '2026-12-31'), 'paid');
});

test('rule 14 — the labels the ledger and the card print', () => {
  const label = (installment, today) => plan.statusLabel(installment, plan.statusOf(installment, today));
  assert.equal(label({ dueDate: '2026-11-20', paid: 0 }, TODAY), 'À venir');
  assert.equal(label({ dueDate: '2026-10-27', paid: 0 }, TODAY), 'À demander');
  assert.equal(label({ dueDate: '2026-10-27', paid: 0, requestedAt: '2026-10-27T09:00:00Z' }, TODAY), 'Demandée le 27/10');
  assert.equal(label({ dueDate: '2026-10-27', paid: 1, paidDate: '2026-10-28', paidMethod: 'transfer' }, TODAY), 'Payée le 28/10 · virement');
  assert.equal(label({ dueDate: '2026-10-20', paid: 0 }, TODAY), 'En retard');
});

// ── Rule 11 — dates ─────────────────────────────────────────────────────────────────────────────────
test('rule 11 — a date in the past, after the arrival or out of order is refused with a message naming the installment', () => {
  const rows = [row(1, 1, { dueDate: '2026-10-27' }), row(2, 1, { dueDate: '2027-02-04' }), row(3, 1, { dueDate: '2027-05-15' })];
  const check = (index, dueDate) => plan.validateDate({ installments: rows, index, dueDate, today: TODAY, startDate: ARRIVAL });
  assert.equal(check(1, '2027-01-10'), null);
  assert.match(check(1, '2026-10-01'), /^Échéance 2 : date passée/);
  assert.match(check(1, '2027-07-01'), /^Échéance 2 : après l'arrivée du 14\/06\/2027/);
  assert.match(check(1, '2026-10-27'), /^Échéance 2 : après l'échéance 1 \(27\/10\/2026\)/);
  assert.match(check(1, '2027-05-15'), /^Échéance 2 : avant l'échéance 3 \(15\/05\/2027\)/);
  assert.match(check(1, ''), /date invalide/);
});

// ── Controller — rules 1-3, 5, 12, 13, 16, 17 on an in-memory database ──────────────────────────────
async function createPlan(harness, count = 3) {
  return call(harness.controller.put, { params: { id: harness.reservationId }, body: { count } });
}

test('rules 5, 6, 10, 23 — creating a plan stores the installments, the aggregates and zeroes the buckets', async () => {
  const h = createHarness();
  h.state.quote = { preArrivalAmount: 1001.5, depositAmount: 0, balanceAmount: 0, depositDueDate: null, balanceDueDate: null };
  const { status, body } = await createPlan(h);
  assert.equal(status, 200);
  const installments = body.installmentPlan.installments;
  assert.deepEqual(installments.map((i) => i.amount), [334, 334, 333.5]);
  assert.deepEqual(installments.map((i) => i.status), ['toRequest', 'upcoming', 'upcoming']);
  assert.equal(body.installmentPlan.total, 1001.5);
  assert.equal(body.installmentPlan.maxCount, 12);
  assert.equal(body.installmentPlan.countLocked, false);
  const stay = h.db.prepare('SELECT * FROM reservations WHERE id = ?').get(h.reservationId);
  assert.deepEqual([stay.installmentsPaidAmount, stay.installmentsUnpaidAmount, stay.installmentsTarget], [0, 1001.5, 1001.5]);
  assert.deepEqual([stay.depositAmount, stay.balanceAmount, stay.balanceDueDate], [0, 0, null], 'the plan replaces acompte and solde');
});

test('rule 12 — changing the count recomputes the default dates, edited dates are lost', async () => {
  const h = createHarness();
  await createPlan(h, 3);
  const second = h.installmentsModel.listFor(h.reservationId)[1];
  const edited = await call(h.controller.put, { params: { id: h.reservationId }, body: { dates: [{ id: second.id, dueDate: '2027-01-10' }] } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.installmentPlan.installments[1].dueDate, '2027-01-10');
  const four = await createPlan(h, 4);
  assert.equal(four.body.installmentPlan.count, 4);
  assert.deepEqual(four.body.installmentPlan.installments.map((i) => i.amount), [250, 250, 250, 251.5]);
  assert.equal(four.body.installmentPlan.installments[0].dueDate, TODAY);
  assert.equal(four.body.installmentPlan.installments[3].dueDate, '2027-05-15');
});

test('rule 3 — a count outside 2..max, or a total too low, is refused with 400', async () => {
  const h = createHarness();
  for (const count of [1, 13, 'x']) {
    const refused = await createPlan(h, count);
    assert.equal(refused.status, 400, `count ${count}`);
    assert.match(refused.body.message, /Entre 2 et 12 échéances/);
  }
  const poor = createHarness({ preArrival: 2.5 });
  const refused = await createPlan(poor, 3);
  assert.equal(refused.status, 400);
  assert.match(refused.body.message, /Total trop faible/);
});

test('rules 1, 30 — a platform booking, a devis and a cancelled stay never get a plan (409, eligible false)', async () => {
  for (const stay of [{ platform: 'Booking' }, { kind: 'devis' }, { kind: 'cancelled' }]) {
    const h = createHarness({ stay });
    const refused = await createPlan(h);
    assert.equal(refused.status, 409, JSON.stringify(stay));
    assert.equal(h.installmentsModel.listFor(h.reservationId).length, 0);
    assert.equal(h.controller.planFor(h.reservationId).eligible, false);
  }
});

test('rule 1 — a platform marked « countsAsDirect » (Lodgify-recorded stay) is direct, a strict test would have refused it', async (t) => {
  setDirectChannels(['direct', 'lodgify']);
  t.after(() => setDirectChannels(['direct']));
  const h = createHarness({ stay: { platform: 'Lodgify' } });
  const created = await createPlan(h);
  assert.equal(created.status, 200);
  assert.equal(created.body.installmentPlan.eligible, true);
});

test('rules 2, 30 — nothing may have been collected: money already in refuses the plan (eligible, canCreate false, reason)', async () => {
  const h = createHarness();
  h.db.prepare('UPDATE reservations SET depositPaid = 1 WHERE id = ?').run(h.reservationId);
  const refused = await createPlan(h);
  assert.equal(refused.status, 409);
  const payload = h.controller.planFor(h.reservationId);
  assert.equal(payload.eligible, true);
  assert.equal(payload.canCreate, false);
  assert.match(payload.reason, /paiement est déjà enregistré/);
});

test('rule 2 — a stay too close to the arrival cannot be split', async () => {
  const h = createHarness({ stay: { startDate: '2026-11-05' } });
  const payload = h.controller.planFor(h.reservationId);
  assert.equal(payload.canCreate, false);
  assert.match(payload.reason, /Trop près de l’arrivée/);
  assert.equal((await createPlan(h)).status, 400);
});

test('rule 2 — once an installment is paid the count and the plan itself are locked', async () => {
  const h = createHarness();
  await createPlan(h);
  const [first] = h.installmentsModel.listFor(h.reservationId);
  const paid = await call(h.controller.markPaid, { params: { id: h.reservationId, installmentId: first.id }, body: { paidDate: TODAY, method: 'transfer' } });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.installmentPlan.countLocked, true);
  assert.equal((await createPlan(h, 4)).status, 409);
  const removal = await call(h.controller.remove, { params: { id: h.reservationId } });
  assert.equal(removal.status, 409);
  assert.equal(h.installmentsModel.listFor(h.reservationId).length, 3);
});

test('rules 5, 30 — removing a plan with nothing paid (answers the empty payload, not null) gives the buckets back, recomputed by the usual split', async () => {
  const h = createHarness();
  await createPlan(h);
  h.state.quote = { preArrivalAmount: 1001.5, depositAmount: 300, balanceAmount: 701.5, depositDueDate: '2026-11-03', balanceDueDate: '2027-05-15' };
  const removal = await call(h.controller.remove, { params: { id: h.reservationId } });
  assert.equal(removal.status, 200);
  assert.equal(removal.body.installmentPlan.installments.length, 0);
  const stay = h.db.prepare('SELECT * FROM reservations WHERE id = ?').get(h.reservationId);
  assert.deepEqual([stay.depositAmount, stay.balanceAmount, stay.depositDueDate, stay.balanceDueDate], [300, 701.5, '2026-11-03', '2027-05-15']);
  assert.deepEqual([stay.installmentsPaidAmount, stay.installmentsUnpaidAmount, stay.installmentsTarget], [0, 0, 0]);
});

test('rule 11 — an invalid date is refused with 400 and the previous value is kept', async () => {
  const h = createHarness();
  await createPlan(h);
  const [first, second] = h.installmentsModel.listFor(h.reservationId);
  const before = second.dueDate;
  for (const [dueDate, pattern] of [['2026-10-01', /date passée/], ['2027-07-01', /après l'arrivée/], [first.dueDate, /après l'échéance 1/]]) {
    const refused = await call(h.controller.put, { params: { id: h.reservationId }, body: { dates: [{ id: second.id, dueDate }] } });
    assert.equal(refused.status, 400);
    assert.match(refused.body.message, pattern);
    assert.equal(refused.body.installmentId, second.id);
  }
  assert.equal(h.installmentsModel.findById(second.id).dueDate, before);
});

test('rule 9a — a typed amount pins the installment, the others follow; a refused one changes nothing', async () => {
  const h = createHarness();
  await createPlan(h);
  const [first, , last] = h.installmentsModel.listFor(h.reservationId);
  const typed = await call(h.controller.put, { params: { id: h.reservationId }, body: { amounts: [{ id: first.id, amount: 500 }] } });
  assert.equal(typed.status, 200);
  const installments = typed.body.installmentPlan.installments;
  assert.deepEqual(installments.map((i) => i.amount), [500, 251, 250.5]);
  assert.deepEqual(installments.map((i) => i.amountEdited), [true, false, false]);
  assert.equal(installments[2].amountEditable, false, 'the last unpaid installment adjusts, it is never typed');

  const refusedLast = await call(h.controller.put, { params: { id: h.reservationId }, body: { amounts: [{ id: last.id, amount: 100 }] } });
  assert.equal(refusedLast.status, 400);
  const refusedTooMuch = await call(h.controller.put, { params: { id: h.reservationId }, body: { amounts: [{ id: installments[1].id, amount: 600 }] } });
  assert.equal(refusedTooMuch.status, 400);
  assert.equal(refusedTooMuch.body.message, "Laisse moins de 1 € à l'échéance 3.");
  assert.deepEqual(h.installmentsModel.listFor(h.reservationId).map((r) => r.amountCents), [50000, 25100, 25050]);
});

test('rules 7, 8 — a save that changes the total rebalances before the first payment, freezes after it', async () => {
  const h = createHarness();
  await createPlan(h);
  h.controller.syncAfterSave(h.reservationId, { preArrivalAmount: 1091.5 });
  assert.deepEqual(h.installmentsModel.listFor(h.reservationId).map((r) => r.amountCents), [36400, 36400, 36350]);

  const [first] = h.installmentsModel.listFor(h.reservationId);
  await call(h.controller.markPaid, { params: { id: h.reservationId, installmentId: first.id }, body: { paidDate: TODAY, method: 'cash' } });
  h.controller.syncAfterSave(h.reservationId, { preArrivalAmount: 1141.5 });
  assert.deepEqual(h.installmentsModel.listFor(h.reservationId).map((r) => r.amountCents), [36400, 36400 + 2500, 36350 + 2500]);

  h.controller.syncAfterSave(h.reservationId, { preArrivalAmount: 1000 });
  const payload = h.controller.planFor(h.reservationId);
  assert.deepEqual(payload.installments.map((i) => i.amount), [364, 389, 388.5]);
  assert.equal(payload.gap, 141.5);
  assert.equal(payload.frozen, true);
});

test('rule 13 — a stay moved earlier brings the unpaid dates back to the arrival, in order', async () => {
  const h = createHarness();
  await createPlan(h);
  h.db.prepare("UPDATE reservations SET startDate = '2027-03-01' WHERE id = ?").run(h.reservationId);
  h.controller.syncAfterSave(h.reservationId, { preArrivalAmount: 1001.5 });
  const dates = h.installmentsModel.listFor(h.reservationId).map((r) => r.dueDate);
  assert.deepEqual(dates, [TODAY, '2027-02-04', '2027-03-01']);
  assert.ok(dates[0] < dates[1] && dates[1] < dates[2], 'strictly ordered');
  assert.equal(h.controller.planFor(h.reservationId).installments[2].clamped, true, 'flagged for the ledger');
});

test('rule 1 — a platform switch ends a plan with nothing paid; with money in, the switch is refused', async () => {
  const h = createHarness();
  await createPlan(h);
  assert.equal(h.controller.platformChangeRefusal(h.reservationId, 'direct'), null);
  assert.equal(h.controller.platformChangeRefusal(h.reservationId, 'Booking'), null);
  h.db.prepare("UPDATE reservations SET platform = 'Booking' WHERE id = ?").run(h.reservationId);
  h.controller.syncAfterSave(h.reservationId, { preArrivalAmount: 1001.5 });
  assert.equal(h.installmentsModel.listFor(h.reservationId).length, 0, 'the plan is gone, acompte and solde come back');

  const paid = createHarness();
  await createPlan(paid);
  const [first] = paid.installmentsModel.listFor(paid.reservationId);
  await call(paid.controller.markPaid, { params: { id: paid.reservationId, installmentId: first.id }, body: { method: 'transfer' } });
  const refusal = paid.controller.platformChangeRefusal(paid.reservationId, 'Booking');
  assert.equal(refusal.status, 409);
});

test('rule 16 — a manual mark takes the date and the mode, refuses a future date, a replay and an unknown mode', async () => {
  const h = createHarness();
  await createPlan(h);
  const [first, second] = h.installmentsModel.listFor(h.reservationId);
  const at = (installmentId, body) => call(h.controller.markPaid, { params: { id: h.reservationId, installmentId }, body });

  assert.equal((await at(first.id, { paidDate: '2026-12-01', method: 'transfer' })).status, 400, 'no future date');
  assert.equal((await at(first.id, { paidDate: TODAY, method: 'crypto' })).status, 400);
  const ok = await at(first.id, { paidDate: '2026-10-25', method: 'cheque' });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.installmentPlan.installments[0].paidDate, ok.body.installmentPlan.installments[0].method], ['2026-10-25', 'cheque']);
  assert.equal(ok.body.installmentPlan.installments[0].statusLabel, 'Payée le 25/10 · chèque');
  assert.equal((await at(first.id, { method: 'cash' })).status, 409, 'a replay never re-dates the payment');
  assert.equal((await at(second.id + 99, { method: 'cash' })).status, 404);
  const stay = h.db.prepare('SELECT installmentsPaidAmount, installmentsUnpaidAmount FROM reservations WHERE id = ?').get(h.reservationId);
  assert.deepEqual([stay.installmentsPaidAmount, stay.installmentsUnpaidAmount], [334, 667.5]);
  assert.deepEqual(h.state.events, [['reservation.paid', { reservationId: h.reservationId, bucket: 'installment' }]]);
});

test('the payload says whether a payment provider can mint links (`canRequest`)', async () => {
  const withProvider = createHarness();
  const withoutProvider = createHarness({ providerReady: false });
  await createPlan(withProvider);
  await createPlan(withoutProvider);
  assert.equal(withProvider.controller.planFor(withProvider.reservationId).canRequest, true);
  assert.equal(withoutProvider.controller.planFor(withoutProvider.reservationId).canRequest, false);
});

test('a second stay is not touched by the first one’s plan', async () => {
  const h = createHarness();
  const other = addStay(h.db, {});
  await createPlan(h);
  assert.equal(h.installmentsModel.listFor(other).length, 0);
  assert.equal(h.controller.planFor(other).installments.length, 0);
});

test('rules 8, 25 — the payload names what a rise just added to each unpaid installment, until the next recalculation', async () => {
  const h = createHarness();
  await createPlan(h);
  const [first] = h.installmentsModel.listFor(h.reservationId);
  await call(h.controller.markPaid, { params: { id: h.reservationId, installmentId: first.id }, body: { paidDate: TODAY, method: 'transfer' } });
  h.controller.syncAfterSave(h.reservationId, { preArrivalAmount: 1091.5 });
  assert.deepEqual(h.controller.planFor(h.reservationId).installments.map((i) => i.added), [0, 45, 45]);
  h.controller.syncAfterSave(h.reservationId, { preArrivalAmount: 1091.5 });
  assert.deepEqual(h.controller.planFor(h.reservationId).installments.map((i) => i.added), [0, 0, 0], 'nothing new to add: the mark goes');
});

test('rule 12 — the payload flags the dates and amounts the operator edited, so the card can warn before a recount', async () => {
  const h = createHarness();
  await createPlan(h);
  const [first, second] = h.installmentsModel.listFor(h.reservationId);
  await call(h.controller.put, { params: { id: h.reservationId }, body: { dates: [{ id: second.id, dueDate: '2027-01-10' }] } });
  await call(h.controller.put, { params: { id: h.reservationId }, body: { amounts: [{ id: first.id, amount: 500 }] } });
  const payload = h.controller.planFor(h.reservationId).installments;
  assert.deepEqual(payload.map((i) => i.dateEdited), [false, true, false]);
  assert.deepEqual(payload.map((i) => i.amountEdited), [true, false, false]);
});

// ── Rule 32 — rounding that never starves or lowers an installment ────────────────────────────────
test('rule 32 — a rise of 1,50 € over 3 unpaid installments lowers none and is never negative', () => {
  const rows = [row(1, 30000, { paid: 1 }), row(2, 30000), row(3, 30000), row(4, 30000)];
  const result = plan.rebalance({ installments: rows, targetCents: 120150 });
  assert.deepEqual(amountsOf(result), [30000, 30000, 30000, 30150], 'rounded shares would have been 1 + 1 − 0,50: floored instead');
  assert.deepEqual([...result.added.values()], [0, 0, 150]);
});

test('rule 32 — a rise of 6 € over 4 floating installments (one pinned) keeps every share ≥ 0 and adds up', () => {
  const rows = [row(1, 20000, { paid: 1 }), row(2, 20000, { amountEdited: 1 }), row(3, 20000), row(4, 20000), row(5, 20000), row(6, 20000)];
  const result = plan.rebalance({ installments: rows, targetCents: 120600 });
  const added = [...result.added.values()];
  assert.equal(added.length, 4);
  assert.ok(added.every((cents) => cents >= 0));
  assert.equal(added.reduce((a, b) => a + b, 0), 600);
  const before = rows.map((r) => r.amountCents);
  amountsOf(result).forEach((cents, i) => assert.ok(cents >= before[i], `installment ${i + 1} was not lowered`));
});

test('rule 32 — a spread whose rounded last share would fall under 1 € floors every share instead', () => {
  assert.deepEqual(plan.spreadCents(25000, 3, { minLast: 100 }), [8300, 8300, 8400], 'ordinary rounding keeps its example');
  assert.deepEqual(plan.spreadCents(450, 3, { minLast: 100 }), [100, 100, 250], '4,50 € over 3: the rounded last would be 0,50 €');
});

test('rule 32 — the validated example is unchanged: 1 001,50 € in 3 is 334 + 334 + 333,50', () => {
  assert.deepEqual(plan.splitEuros(100150, 3), [33400, 33400, 33350]);
});

test('rule 33 — what was collected covers the stay: the rest of the plan is not due (aggregates, payload)', async () => {
  const h = createHarness();
  h.state.quote = { preArrivalAmount: 1001.5, depositAmount: 0, balanceAmount: 0, depositDueDate: null, balanceDueDate: null };
  await createPlan(h);
  const [first] = h.installmentsModel.listFor(h.reservationId);
  await call(h.controller.markPaid, { params: { id: h.reservationId, installmentId: first.id }, body: { paidDate: TODAY, method: 'transfer' } });
  h.controller.syncAfterSave(h.reservationId, { preArrivalAmount: 300 });
  const stay = h.db.prepare('SELECT installmentsPaidAmount, installmentsUnpaidAmount FROM reservations WHERE id = ?').get(h.reservationId);
  assert.deepEqual([stay.installmentsPaidAmount, stay.installmentsUnpaidAmount], [334, 0], 'nothing more is owed');
  const payload = h.controller.planFor(h.reservationId);
  assert.equal(payload.settled, true);
  assert.equal(payload.canRequest, false, 'no request for money that is not owed');
  assert.equal(payload.remaining, 0);
  assert.equal(h.controller.lateInstallments('2030-01-01').length, 0, 'not in the collection alert');
  const { remainingToPay } = require('../utils/reservationSettlement');
  assert.equal(remainingToPay(h.db.prepare('SELECT * FROM reservations WHERE id = ?').get(h.reservationId)), 0);
});

test('rule 24 — the plan is frozen as soon as ANY installment is paid, not only the first', async () => {
  const h = createHarness();
  await createPlan(h);
  const [, second] = h.installmentsModel.listFor(h.reservationId);
  await call(h.controller.markPaid, { params: { id: h.reservationId, installmentId: second.id }, body: { paidDate: TODAY, method: 'cash' } });
  const payload = h.controller.planFor(h.reservationId);
  assert.deepEqual([payload.frozen, payload.countLocked], [true, true]);
  h.controller.syncAfterSave(h.reservationId, { preArrivalAmount: 1091.5 });
  assert.deepEqual(h.installmentsModel.listFor(h.reservationId).map((r) => r.amountCents), [37900, 33400, 37850],
    'the paid installment 2 keeps its amount; the rise is spread over the unpaid 1 and 3');
});
