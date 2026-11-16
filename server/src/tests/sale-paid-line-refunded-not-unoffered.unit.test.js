// specs/pricing-components.md §3 rule 108 (stabilisation loop t7, D7-1, owner decision 2026-11-16) — a paid line offered, its money then REFUNDED
// on the trop-perçu, can no longer be un-offered: putting it back at its price would make its note claim money the guest already got back, and the
// guest would keep the line AND the money (Σ buckets + notes − owed − refunded − total read −30 €). Every save refuses it through the one
// paid-line judgment — the fiche's « Enregistrer », the line API, both SAS commits — with 409 `LINE_REFUNDED` « Ligne remboursée : la revendre
// comme une nouvelle ligne. », and the fiche is served the lines concerned (`refundedLoweredLines`) so it does not offer the gesture.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');

const wine = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Vin rond', 50, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) SELECT propertyId, ? FROM property_options WHERE optionId = ? LIMIT 1').run(wine, beer);
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refunds = require('../controllers/refundsController');
const reservations = require('../models/reservationsModel');
const paidLineJudgment = require('../utils/paidLineJudgment');
const { withNow } = require('../utils/localDate');
const { storedBody } = require('../utils/stayOrderLines');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (v) => Math.round(Number(v || 0) * 100);
const notes = (id) => JSON.parse(row(id).midStaySettledNotes || '[]').reduce((sum, note) => sum + cents(note.total), 0);
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
const refunded = (id) => cents(db.prepare('SELECT COALESCE(SUM(totalTtc), 0) AS t FROM reservation_refunds WHERE reservationId = ?').get(id).t);
const balanced = (id) => {
  const r = row(id);
  return cents(r.depositAmount) + cents(r.balanceAmount) + cents(r.complementAmount) + cents(r.endOfStayComplementAmount) + notes(id) - owed(id) - refunded(id)
    - cents(r.finalPrice) - cents(r.touristTaxTotal);
};
const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const call = (handler, params, body) => { const res = respond(); handler({ params, body, query: {}, user: { id: 1, role: 'admin' } }, res); return res; };
const beerLine = (id) => db.prepare('SELECT lineId, offered, totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, beer);
const withBeerOffered = (id, offered) => {
  const body = storedBody(id);
  return { ...body, options: body.options.map((o) => (Number(o.optionId) === beer ? { ...o, offered } : o)) };
};
const refundTropPercu = (id, amountTtc = 30) => {
  const over = ctrl.storedOverpayment(id);
  const made = call(refunds.create, { id: String(id) }, {
    refundDate: todayIso(), method: (over && over.overpaymentMethod) || 'card', reason: 'Trop-perçu', fromOverpayment: true, overpaymentTtc: amountTtc,
    lines: [{ label: 'Trop-perçu', bucket: 'accommodation', amountTtc }],
  });
  assert.equal(made.statusCode, 201, JSON.stringify(made.body));
  return made.body.refund.id;
};
const REFUSED = { code: 'LINE_REFUNDED', error: 'Ligne remboursée : la revendre comme une nouvelle ligne.' };

// A plan paid in full, 30 € of beer ordered in the app and paid by card three days before the arrival.
function paidBeer(platform = 'direct') {
  const id = stay(3);
  if (platform !== 'direct') db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(todayIso(), id);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1' }).status, 200);
  return { id, now, ref: `option:${beerLine(id).lineId}` };
}

for (const platform of ['direct', 'Booking']) {
  test(`D7-1 — ${platform}: fiche save — offered, refunded, then un-offered: 409 LINE_REFUNDED, nothing written, Σ balanced`, () => {
    const { id, now } = paidBeer(platform);
    assert.equal(ctrl.performUpdate(id, { ...withBeerOffered(id, true), forceOverpayment: true }, { now }).status, 200);
    assert.equal(owed(id), 3000);
    refundTropPercu(id);
    assert.deepEqual([owed(id), balanced(id)], [0, 0]);
    assert.deepEqual(paidLineJudgment.refundedLoweredLines(db, id).map((l) => [l.key, l.table, l.lineId]), [[`opt:${beer}`, 'option', beerLine(id).lineId]]);
    const before = { row: row(id), line: beerLine(id) };
    const back = ctrl.performUpdate(id, withBeerOffered(id, false), { now });
    assert.equal(back.status, 409);
    assert.deepEqual({ code: back.body.code, error: back.body.error }, REFUSED);
    assert.deepEqual([row(id), beerLine(id), balanced(id)], [before.row, before.line, 0], 'nothing written');
  });
}

for (const [platform, payment] of [['direct', 'cash'], ['direct', 'card'], ['Booking', 'card']]) {
  test(`D7-1 — ${platform} ${payment}: line API on a started stay — offered, refunded, then un-offered: 409 LINE_REFUNDED`, () => {
    const id = stay(20);
    if (platform !== 'direct') db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
    ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
    ctrl.updatePayment({ params: { id: String(id) }, body: { balancePaid: true, balancePaidDate: todayIso() }, query: {}, user: { id: 1, role: 'admin' } }, respond());
    ctrl.updatePayment({ params: { id: String(id) }, body: { checkInDone: true }, query: {}, user: { id: 1, role: 'admin' } }, respond());
    const sold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at(id, '12:00', 1), payment });
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
    const ref = sold.saleDetail.lines.find((l) => l.articleKey === `option:${beer}`).ref;
    assert.equal(extraSale.changeLine(id, ref, { offered: true }, { now: at(id, '12:30', 1), forceOverpayment: true }).status, 200);
    refundTropPercu(id);
    const back = extraSale.changeLine(id, ref, { offered: false }, { now: at(id, '13:00', 1) });
    assert.deepEqual([back.status, back.body.code, back.body.error], [409, REFUSED.code, REFUSED.error]);
    assert.deepEqual([beerLine(id).offered, balanced(id)], [1, 0]);
  });
}

test('D7-1 — a refund deleted gives the money back to the stay: the line can be un-offered again, and is no longer listed', () => {
  const { id, now, ref } = paidBeer();
  assert.equal(extraSale.changeLine(id, ref, { offered: true }, { now, forceOverpayment: true }).status, 200);
  const refundId = refundTropPercu(id);
  assert.equal(extraSale.changeLine(id, ref, { offered: false }, { now }).status, 409);
  assert.equal(call(refunds.remove, { id: String(id), refundId: String(refundId) }).statusCode, 200);
  assert.equal(owed(id), 3000);
  assert.deepEqual(paidLineJudgment.refundedLoweredLines(db, id), []);
  const back = extraSale.changeLine(id, ref, { offered: false }, { now });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.deepEqual([beerLine(id).offered, owed(id), balanced(id)], [0, 0, 0]);
});

test('D7-1 — a refund of only part of the excess: the line stays locked while it would claim refunded money; an unrelated save goes through', () => {
  const { id, now, ref } = paidBeer();
  assert.equal(extraSale.changeLine(id, ref, { offered: true }, { now, forceOverpayment: true }).status, 200);
  refundTropPercu(id, 10);
  assert.deepEqual([owed(id), balanced(id)], [2000, 0]);
  assert.equal(extraSale.changeLine(id, ref, { offered: false }, { now }).body.code, 'LINE_REFUNDED');
  assert.equal(ctrl.performUpdate(id, storedBody(id), { now }).status, 200, 'a save that claims nothing back is not refused');
  assert.deepEqual([owed(id), balanced(id)], [2000, 0]);
});

test('D7-1 — a paid line offered and NOT refunded is not listed and can still be un-offered (rule 107 a)', () => {
  const { id, now, ref } = paidBeer();
  assert.equal(extraSale.changeLine(id, ref, { offered: true }, { now, forceOverpayment: true }).status, 200);
  assert.deepEqual(paidLineJudgment.refundedLoweredLines(db, id), []);
  assert.equal(extraSale.changeLine(id, ref, { offered: false }, { now }).status, 200);
  assert.deepEqual([owed(id), balanced(id)], [0, 0]);
});

test('D7-1 — the arrival SAS commit: the paid line offered at the door, refunded, then the SAS re-committed without it: 409 LINE_REFUNDED, nothing written', () => {
  const { id } = paidBeer();
  const door = at(id, '17:00');
  const offeredExtras = [{ kind: 'option', id: beer }];
  withNow(door, () => reservations.commitArrivalSas(id, { complementItems: [], offeredExtras, forceOverpayment: true }));
  assert.deepEqual([beerLine(id).offered, owed(id)], [1, 3000]);
  refundTropPercu(id);
  const plan = withNow(door, () => reservations.planArrivalSas(id, { complementItems: [] }));
  assert.deepEqual(plan.lines.filter((l) => l.offerLocked).map((l) => [l.label, l.offered]), [['Bière ronde', true]], 'the dialog is told not to offer the toggle');
  const before = { row: row(id), line: beerLine(id) };
  assert.throws(() => withNow(door, () => reservations.commitArrivalSas(id, { complementItems: [], offeredExtras: [] })), (err) => {
    assert.deepEqual([err.refusal.status, err.refusal.body.code, err.refusal.body.error], [409, REFUSED.code, REFUSED.error]);
    return true;
  });
  assert.deepEqual([row(id), beerLine(id), balanced(id)], [before.row, before.line, 0], 'nothing written');
});

test('D7-1 — the departure SAS commit: the refunded line recalled from an unpaid arrival complement and no longer named offered: 409 LINE_REFUNDED, nothing written', () => {
  const { id, now } = paidBeer();
  // A dearer article sold on the fiche and never collected: the beer's money pays part of it once the beer is offered (rule 104), the arrival
  // complement stays unpaid and the departure SAS recalls its lines. A trop-perçu refund cannot coexist with money still due, so the refund the
  // register already settled is written as the register holds it (a `lineLowered` row settled by a refund) — the departure commit's own wiring
  // to the judgment is what this case proves.
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${wine}`, quantity: 1 }], { now }).status, 200);
  assert.equal(ctrl.performUpdate(id, withBeerOffered(id, true), { now }).status, 200);
  // Note money (loop t8, rule 115): the settled row carries its note part.
  db.prepare("INSERT INTO refund_obligations (reservationId, origin, amountCents, reason, status, settledAt, settledBy, noteCents) VALUES (?, 'lineLowered', 3000, 'ligne payée baissée', 'settled', datetime('now'), 'refund:999', 3000)").run(id);
  const departure = at(id, '09:00', 3);
  const plan = withNow(departure, () => reservations.planDepartureSas(id, {}));
  assert.deepEqual(plan.lines.filter((l) => l.offerLocked).map((l) => [l.label, l.offered]), [['Bière ronde', true]], 'the dialog is told not to offer the toggle');
  const before = { row: row(id), line: beerLine(id) };
  assert.throws(() => withNow(departure, () => reservations.commitDepartureSas(id, { cautionReturned: true, offeredArrivalExtras: [] })), (err) => {
    assert.deepEqual([err.refusal.status, err.refusal.body.code, err.refusal.body.error], [409, REFUSED.code, REFUSED.error]);
    return true;
  });
  assert.deepEqual([row(id), beerLine(id)], [before.row, before.line], 'nothing written');
  withNow(departure, () => reservations.commitDepartureSas(id, { cautionReturned: true, offeredArrivalExtras: [{ kind: 'option', id: beer, lineId: beerLine(id).lineId }] }));
  assert.equal(beerLine(id).offered, 1, 'the SAS that keeps it offered goes through');
});

test('D7-1 — the fiche payload serves the locked lines (`refundedLoweredLines`)', () => {
  const { id, now, ref } = paidBeer();
  assert.equal(extraSale.changeLine(id, ref, { offered: true }, { now, forceOverpayment: true }).status, 200);
  refundTropPercu(id);
  const res = call(ctrl.getById, { id: String(id) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.refundedLoweredLines.map((l) => l.key), [`opt:${beer}`]);
});
