// specs/reservation-refunds.md rule 46 and specs/payment-schedule-and-cancellation.md rule 32bis, readings of
// 2026-11-02 (audit R14-C1). The fiche's ledger showed a cancellation's `retained` avoir as « Remboursement ·
// Rendu le 01/11 · retained »: money given back, and a raw English code. That money was kept as an indemnity.

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLedger, formatEuros } = require('../utils/reservationLedger');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const inDays = (n) => addDaysToIsoDate(todayIso(), n);
const TODAY = inDays(0);
const START = inDays(40);
// The ledger's « JJ/MM » (the year added when it is not the stay's).
const short = (iso) => { const [y, m, d] = iso.split('-'); return y === START.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`; };

const cancelledRow = (over = {}) => ({
  id: 7, kind: 'cancelled', platform: 'direct', startDate: START, endDate: inDays(47),
  depositAmount: 274, balanceAmount: 640, complementAmount: 0, endOfStayComplementAmount: 0,
  depositPaid: 1, depositPaidDate: inDays(-20), balancePaid: 0, complementPaid: 0, endOfStayComplementPaid: 0,
  cautionReceived: 0, cautionReturned: 0,
  ...over,
});
const retained = { id: 3, refundDate: inDays(-1), method: 'retained', totalTtc: 274, lines: [{ label: 'Hébergement', bucket: 'accommodation', amountTtc: 274 }] };
const rowOf = (ledger, key) => ledger.rows.find((r) => r.key === key);

test('a retained acompte reads « Acompte conservé · Requalifié en indemnité le JJ/MM », never « Rendu »', () => {
  const ledger = buildLedger({ row: cancelledRow(), refunds: [retained], today: TODAY });
  const row = rowOf(ledger, 'refund-3');
  assert.equal(row.label, 'Acompte conservé');
  assert.equal(row.stateLabel, `Requalifié en indemnité le ${short(inDays(-1))}`);
  assert.equal(row.state, 'retained');
  assert.equal(row.action, null);
});

test('the installments kept by a cancelled plan read « Échéances conservées »', () => {
  const installmentPlan = { installments: [
    { id: 1, number: 1, dueDate: inDays(-30), amountCents: 103000, paid: 1, paidDate: inDays(-30) },
    { id: 2, number: 2, dueDate: inDays(-2), amountCents: 103000, paid: 1, paidDate: inDays(-15) },
    { id: 3, number: 3, dueDate: inDays(20), amountCents: 102960, paid: 0 },
  ] };
  const plan = { ...retained, totalTtc: 2060, lines: [{ label: 'Hébergement — échéance 1/3', bucket: 'accommodation', amountTtc: 2060 }] };
  const ledger = buildLedger({ row: cancelledRow({ depositAmount: 0, depositPaid: 0 }), refunds: [plan], installmentPlan, today: TODAY });
  const row = rowOf(ledger, 'refund-3');
  assert.equal(row.label, 'Échéances conservées');
  assert.equal(row.stateLabel, `Requalifié en indemnité le ${short(inDays(-1))}`);
  // The cancelled fiche passes no plan: the installments collected still say what was kept.
  const withoutPlan = buildLedger({ row: cancelledRow({ depositAmount: 0, depositPaid: 0, installmentsPaidAmount: 2060 }), refunds: [plan], today: TODAY });
  assert.equal(rowOf(withoutPlan, 'refund-3').label, 'Échéances conservées');
});

test('a refund taken from the indemnity says so; a mixed one names the share', () => {
  const fromIndemnity = { id: 4, refundDate: TODAY, method: 'transfer', totalTtc: 200, lines: [{ label: 'Hébergement', bucket: 'indemnity', amountTtc: 200 }] };
  const mixed = { id: 5, refundDate: TODAY, method: 'transfer', totalTtc: 700, lines: [
    { label: 'Hébergement', bucket: 'accommodation', amountTtc: 640 },
    { label: 'Hébergement', bucket: 'indemnity', amountTtc: 60 },
  ] };
  const ledger = buildLedger({ row: cancelledRow(), refunds: [retained, fromIndemnity, mixed], today: TODAY });
  assert.equal(rowOf(ledger, 'refund-4').label, 'Remboursement');
  assert.equal(rowOf(ledger, 'refund-4').stateLabel, `Rendu sur l'indemnité le ${short(TODAY)} · virement`);
  assert.equal(rowOf(ledger, 'refund-5').stateLabel, `Rendu le ${short(TODAY)} · virement`);
  assert.deepEqual(rowOf(ledger, 'refund-5').detail.lines, [`Hébergement : − ${formatEuros(640)}`, `Hébergement · sur l'indemnité : − ${formatEuros(60)}`]);
});

test('an unknown means never shows its raw code', () => {
  const ledger = buildLedger({ row: cancelledRow({ kind: 'reservation' }), refunds: [{ ...retained, id: 6, method: 'retained' }], today: TODAY });
  assert.ok(!/retained/.test(rowOf(ledger, 'refund-6').stateLabel));
});
