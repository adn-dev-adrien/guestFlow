// specs/mollie-rolling-reserve-and-incoming-payments.md rules 1-4, 6-7 — the split of a Mollie card payment in an
// immediate share and a reserve. Fictional data only; the measured cases are the 196,80 € pair and the 14,00 € sale.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeSplit, afterRefund, expectedDates, readReserveSettings, createSplitsModel, rateMessage, holdMessage, sinceMessage, linkLedgerKey,
} = require('../reconciliation/molliePaymentSplits');
const { expectedReceiptsOfReservation } = require('../reconciliation/expectedReceipts');
const { buildLedger } = require('../../../utils/reservationLedger');
const { parseGroup } = require('../../../utils/arrivalPaymentGroup');
const paymentLinks = require('../../../models/paymentLinksModel');
const { mountReconciliation } = require('../reconciliation');
const { db, TODAY, dayAt, reset, paidStay } = require('./mollieFixture');
const { capturingCtx } = require('./mollieCtxFixture');

test.beforeEach(() => { reset(); });

const settingsOf = (values = {}) => ({ get: (k) => values[k] || '' });

test('rule 1 — reserve = round(gross × rate) to the cent, the immediate share absorbs the rounding', () => {
  assert.deepEqual(computeSplit({ grossCents: 73240, ratePercent: 20 }), { grossCents: 73240, reserveCents: 14648, immediateCents: 58592 });
  assert.deepEqual(computeSplit({ grossCents: 19680, ratePercent: 20 }), { grossCents: 19680, reserveCents: 3936, immediateCents: 15744 }, 'the measured 157,44 + 39,36 pair');
  assert.deepEqual(computeSplit({ grossCents: 1400, ratePercent: 20 }), { grossCents: 1400, reserveCents: 280, immediateCents: 1120 }, 'the measured Gruat 14,00 -> 11,20');
  const odd = computeSplit({ grossCents: 10003, ratePercent: 20 });
  assert.equal(odd.reserveCents, 2001);
  assert.equal(odd.immediateCents + odd.reserveCents, 10003);
  assert.deepEqual(computeSplit({ grossCents: 10000, ratePercent: 12.5 }), { grossCents: 10000, reserveCents: 1250, immediateCents: 8750 });
});

test('rule 1 — the split is computed once when a link is seen paid, and stored with the rate and the hold it used', () => {
  const { reservationId, link } = paidStay({ cents: 73240, daysAgo: 20 });
  const splits = createSplitsModel(db);
  assert.equal(splits.sync({ settings: settingsOf({ reconciliationStartDate: dayAt(-60) }) }), 1);
  assert.equal(splits.sync({ settings: settingsOf({ reconciliationStartDate: dayAt(-60) }) }), 0, 'seen once');
  const stored = splits.forLink(link.id);
  assert.equal(stored.reservationId, reservationId);
  assert.equal(stored.ledgerKey, 'balance');
  assert.equal(stored.immediateCents, 58592);
  assert.equal(stored.reserveCents, 14648);
  assert.equal(stored.ratePercent, 20);
  assert.equal(stored.holdDays, 90);
});

test('rule 1 — the split is made when the payment is announced, with the settings of that moment', () => {
  const { ctx, store } = capturingCtx({ reconciliationStartDate: dayAt(-60), mollieReservePercent: '30' });
  mountReconciliation(ctx, { store: {} });
  const { link } = paidStay({ cents: 10000, daysAgo: 1 });
  ctx.handlers['reservation.paid']({ reservationId: link.reservationId, bucket: 'balance' });
  store.set('mollieReservePercent', '10');
  const stored = createSplitsModel(db).forLink(link.id);
  assert.deepEqual([stored.reserveCents, stored.ratePercent], [3000, 30]);
  ctx.handlers['reservation.paid']({ reservationId: link.reservationId, bucket: 'balance' });
  assert.equal(createSplitsModel(db).forLink(link.id).reserveCents, 3000, 'a later announcement never moves it');
});

test('rule 2 — a link paid before « Retenue appliquée depuis » has one tranche, 100 %; a rate of 0 disables the reserve', () => {
  const old = paidStay({ cents: 50000, daysAgo: 40 });
  const recent = paidStay({ cents: 50000, daysAgo: 5 });
  const splits = createSplitsModel(db);
  splits.sync({ settings: settingsOf({ mollieReserveSince: dayAt(-10) }) });
  assert.equal(splits.forLink(old.link.id).reserveCents, 0);
  assert.equal(splits.forLink(old.link.id).immediateCents, 50000);
  assert.equal(splits.forLink(recent.link.id).reserveCents, 10000);
  const disabled = paidStay({ cents: 50000, daysAgo: 3 });
  splits.sync({ settings: settingsOf({ mollieReservePercent: '0' }) });
  assert.equal(splits.forLink(disabled.link.id).reserveCents, 0);
});

test('rule 2 — « depuis » falls back on the reconciliation start date; changing a setting never moves a stored split', () => {
  assert.equal(readReserveSettings(settingsOf({ reconciliationStartDate: '2026-10-01' })).since, '2026-10-01'); // date-literal-ok: a setting value, never compared with today
  assert.equal(readReserveSettings(settingsOf({ mollieReserveSince: '2026-11-01', reconciliationStartDate: '2026-10-01' })).since, '2026-11-01'); // date-literal-ok: a setting value, never compared with today
  const { link } = paidStay({ cents: 20000, daysAgo: 4 });
  const splits = createSplitsModel(db);
  splits.sync({ settings: settingsOf({ reconciliationStartDate: dayAt(-60) }) });
  const before = splits.forLink(link.id);
  splits.sync({ settings: settingsOf({ reconciliationStartDate: dayAt(-60), mollieReservePercent: '30', mollieReserveHoldDays: '60' }) });
  assert.deepEqual(splits.forLink(link.id), before);
});

test('rule 3 — a refused rate, hold or date says why, in French', () => {
  assert.equal(rateMessage('20'), null);
  assert.equal(rateMessage('12,5'), null);
  assert.equal(rateMessage(''), null, 'empty keeps the default');
  ['51', '-1', 'abc', '1.234'].forEach((v) => assert.equal(rateMessage(v), 'Le taux doit être compris entre 0 et 50 %', v));
  assert.equal(holdMessage('90'), null);
  ['0', '366', '1.5', 'x'].forEach((v) => assert.equal(holdMessage(v), 'La durée est un nombre de jours entre 1 et 365', v));
  assert.equal(sinceMessage(dayAt(-3), TODAY), null);
  assert.equal(sinceMessage(TODAY, TODAY), null);
  assert.ok(sinceMessage(dayAt(1), TODAY), 'not in the future');
  assert.ok(sinceMessage('2026-02-30', TODAY), 'a real day'); // date-literal-ok: an impossible day, rejected whatever today is
});

test('rule 4 — the immediate share is expected 4 days after the payment, the reserve one hold after the immediate bank date', () => {
  assert.deepEqual(expectedDates({ paidAt: `${dayAt(-10)}T10:00:00Z`, holdDays: 90 }), { immediat: dayAt(-6), retenue: dayAt(84) });
  assert.equal(expectedDates({ paidAt: `${dayAt(-10)}T10:00:00Z`, holdDays: 90, immediateBankDate: dayAt(-8) }).retenue, dayAt(82), 'counted from the real bank date once reconciled');
});

test('rule 6 — a refund reduces the immediate share first, then the reserve', () => {
  const split = { immediateCents: 15744, reserveCents: 3936 };
  assert.deepEqual(afterRefund({ ...split, refundedCents: 5000 }), { immediateCents: 10744, reserveCents: 3936 });
  assert.deepEqual(afterRefund({ ...split, refundedCents: 17000 }), { immediateCents: 0, reserveCents: 2680 });
  assert.deepEqual(afterRefund({ ...split, refundedCents: 19680 }), { immediateCents: 0, reserveCents: 0 }, 'a fully refunded link has nothing left to expect');
});

test('rule 6 — a tranche left at 0 by a refund expects nothing', () => {
  const { reservationId, link } = paidStay({ cents: 19680, daysAgo: 6 });
  const splits = createSplitsModel(db);
  splits.sync({ settings: settingsOf({ reconciliationStartDate: dayAt(-60) }) });
  splits.setRefunded(link.id, 19680);
  const receipts = expectedReceiptsOfReservation({
    db, reservationId, startDate: dayAt(-60), today: TODAY, buildLedger, parseGroup,
    listLinks: (id) => paymentLinks.listForStay(id), listInstallments: () => [], splitFor: (l) => splits.forLink(l.id),
  });
  assert.deepEqual(receipts.filter((r) => r.mollie), []);
});

test('rule 7 — a split link stays one échéance on the fiche: the ledger row, the paid flag and the date do not move', () => {
  const { reservationId, link, paidDay } = paidStay({ cents: 73240, daysAgo: 10 });
  const rowBefore = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
  const splits = createSplitsModel(db);
  splits.sync({ settings: settingsOf({ reconciliationStartDate: dayAt(-60) }) });
  assert.equal(db.prepare('SELECT balancePaid, balancePaidDate FROM reservations WHERE id = ?').get(reservationId).balancePaidDate, paidDay);
  assert.deepEqual(db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId), rowBefore);
  const ledger = buildLedger({ row: rowBefore, links: paymentLinks.listForStay(reservationId), today: TODAY });
  const balance = ledger.rows.filter((r) => r.key === 'balance');
  assert.equal(balance.length, 1);
  assert.ok(String(balance[0].state).startsWith('paid'));
  assert.equal(linkLedgerKey(link), 'balance');
});
