// specs/payment-schedule-and-cancellation.md rule 55 and specs/reservation-refunds.md rule 48, readings of 2026-11-02
// (review of PR #926, residual A). A direct stay collected through a payment provider (Lodgify / Stripe) is booked
// gross, the provider's commission on 622600; what reached the bank is net of it (`comptaCollected`). Cancelled, it
// requalified only the gross acompte: the commissions withheld could neither be given back nor requalified, so once
// every collected euro went back they stayed as sales revenue with collected VAT on a cancelled stay. Now the
// cancellation requalifies them too (the avoir reverses 706 + VAT on them, the indemnity includes them) and the
// register never offers them from the indemnity: 706, 4457, 4671 and the client account end at 0, 7588 keeps the
// commissions and 622600 their cost.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const { setDirectChannels } = require('../utils/platformNameFormat');
const {
  TODAY, round2, accounting, seedWithContribs, seedLegacy, cancel, registerOf, giveBackAll, netByAccount, sumOf,
} = require('./cancelledStayCommissionFixtures');

test.before(() => setDirectChannels(['Lodgify']));
test.after(() => setDirectChannels([]));

test('payment-schedule-and-cancellation rule 55 reading — the commissions withheld are requalified with the acompte kept', () => {
  const { deps } = seedWithContribs();
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 274, 'the acompte kept, as the history says');
  const avoir = deps.refundsModel.listByReservation(10).find((r) => r.method === 'retained');
  // The acompte was reversed whole, its 8,22 € inside; the solde's 19,20 € join it.
  assert.equal(avoir.totalTtc, 293.2);
  assert.equal(round2(avoir.lines.reduce((t, l) => t + l.amountTtc, 0)), 293.2);
  const commission = avoir.lines.filter((l) => l.lineKey === 'commission');
  assert.equal(round2(commission.reduce((t, l) => t + l.amountTtc, 0)), 27.42, 'both commissions named');
  assert.ok(commission.every((l) => l.vatRate === 10 && l.unitPrice === 0 && ['accommodation', 'options'].includes(l.bucket)));
  const compensation = deps.compensationsModel.getById(out.compensationId);
  assert.equal(compensation.receivedAmount, 293.2);
});

test('reservation-refunds rule 48 reading — the register never offers the commissions from the indemnity', () => {
  const { deps, controller } = seedWithContribs();
  cancel(deps);
  const register = registerOf(controller);
  assert.equal(register.collectedTtc, 886.58, 'what reached the bank');
  const offered = register.refundableLines.reduce((t, l) => t + Math.round(l.refundableTtc * 100), 0) / 100;
  const fromIndemnity = register.refundableLines.reduce((t, l) => t + Math.round((l.indemnityTtc || 0) * 100), 0) / 100;
  assert.equal(offered, 886.58);
  assert.equal(fromIndemnity, 265.78, 'the acompte that reached the bank, never the commission withheld on it');
});

test('reservation-refunds rule 48 reading — everything given back: 706, VAT and the client at 0, 7588 the commissions, 622600 their cost', accounting, () => {
  const { db, deps, controller } = seedWithContribs();
  cancel(deps);
  assert.equal(giveBackAll(controller).statusCode, 201);
  assert.equal(registerOf(controller).collectedTtc, 0);
  const net = netByAccount(db);
  assert.equal(sumOf(net, '706'), 0, JSON.stringify(net));
  assert.equal(sumOf(net, '4457'), 0, JSON.stringify(net));
  assert.equal(sumOf(net, '4671'), 0, JSON.stringify(net));
  assert.equal(sumOf(net, '411'), 0, JSON.stringify(net));
  assert.equal(net['75880000'], -27.42);
  assert.equal(net['622600'], 27.42);
});

test('reservation-refunds rule 48 reading — stay #22226 (no contribs): every account nets to the cent, 7588 −6,82, 622600 +6,82', accounting, () => {
  const { db, deps, controller } = seedLegacy();
  cancel(deps);
  assert.equal(giveBackAll(controller).statusCode, 201);
  const net = netByAccount(db);
  for (const account of Object.keys(net).filter((a) => /^(706|4457|4671|411)/.test(a))) assert.equal(net[account], 0, `${account} ${JSON.stringify(net)}`);
  assert.equal(net['75880000'], -6.82);
  assert.equal(net['622600'], 6.82);
});

test('payment-schedule-and-cancellation rule 55 reading — a solde paid with no acompte: its commission alone is requalified', accounting, () => {
  const { db, deps, controller } = seedWithContribs();
  db.prepare('UPDATE reservations SET depositPaid = 0, depositPaidDate = NULL WHERE id = 10').run();
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 0);
  const avoir = deps.refundsModel.listByReservation(10).find((r) => r.method === 'retained');
  assert.equal(avoir.totalTtc, 19.2);
  assert.equal(registerOf(controller).collectedTtc, 620.8);
  assert.equal(giveBackAll(controller).statusCode, 201);
  const net = netByAccount(db);
  assert.equal(sumOf(net, '706'), 0, JSON.stringify(net));
  assert.equal(sumOf(net, '4457'), 0, JSON.stringify(net));
  assert.equal(net['75880000'], -19.2);
});

test('payment-schedule-and-cancellation rule 55 reading — a stay with no commission requalifies exactly what it did', () => {
  const { db, deps } = seedWithContribs();
  db.prepare('UPDATE reservations SET acompteCommissionAmount = NULL, platformCommissionAmount = NULL WHERE id = 10').run();
  const out = cancel(deps);
  const avoir = deps.refundsModel.listByReservation(10).find((r) => r.method === 'retained');
  assert.equal(out.retainedDepositAmount, 274);
  assert.equal(avoir.totalTtc, 274);
  assert.ok(avoir.lines.every((l) => l.lineKey !== 'commission'));
});

test('reservation-refunds rule 48 reading — an acompte only: the avoir stays the acompte, the indemnity offers it net of its commission', accounting, () => {
  const { db, deps, controller } = seedWithContribs({ balancePaid: 0 });
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 274);
  assert.equal(deps.refundsModel.listByReservation(10).find((r) => r.method === 'retained').totalTtc, 274);
  assert.equal(deps.compensationsModel.getById(out.compensationId).receivedAmount, 274);
  assert.equal(registerOf(controller).collectedTtc, 265.78);
  assert.equal(giveBackAll(controller).statusCode, 201);
  const net = netByAccount(db);
  for (const account of Object.keys(net).filter((a) => /^(706|4457|4671|411)/.test(a))) assert.equal(net[account], 0, `${account} ${JSON.stringify(net)}`);
  assert.equal(net['75880000'], -8.22);
  assert.equal(net['622600'], 8.22);
});

test('payment-schedule-and-cancellation rule 55 reading — the ledger names an avoir of a commission alone « Commission retenue »', () => {
  const { buildLedger } = require('../utils/reservationLedger');
  const { db, deps } = seedWithContribs();
  db.prepare('UPDATE reservations SET depositPaid = 0, depositPaidDate = NULL WHERE id = 10').run();
  cancel(deps);
  const refunds = deps.refundsModel.listByReservation(10);
  const ledger = buildLedger({ row: deps.reservationsModel.getForCancellation(10), refunds, today: TODAY });
  const row = ledger.rows.find((r) => r.key === `refund-${refunds[0].id}`);
  assert.equal(row.label, 'Commission retenue');
  assert.equal(row.action, null);
});

test('payment-schedule-and-cancellation rule 55 reading (review of PR #929, F3) — an avoir that adds the solde commission names it in its label', () => {
  const { buildLedger } = require('../utils/reservationLedger');
  const labelOf = ({ balancePaid }) => {
    const { deps } = seedWithContribs({ balancePaid });
    cancel(deps);
    const refunds = deps.refundsModel.listByReservation(10);
    const avoir = refunds.find((r) => r.method === 'retained');
    const row = buildLedger({ row: deps.reservationsModel.getForCancellation(10), refunds, today: TODAY }).rows.find((r) => r.key === `refund-${avoir.id}`);
    return [row.label, row.amount];
  };
  assert.deepEqual(labelOf({ balancePaid: 1 }), ['Acompte et commission conservés', -293.2]);
  assert.deepEqual(labelOf({ balancePaid: 0 }), ['Acompte conservé', -274], 'the acompte commission is inside the acompte');
});
