// specs/reservation-payment-ledger.md rules 31 and 47 — a payment link paid for an amount the
// reservation no longer asks for (review of inte/plugins, 2026-10-23):
//   - a `full` link paid after the stay grew an acompte settles the acompte AND the solde;
//   - a retired complement link is recorded the way the fiche records it, and traced;
//   - an OPEN link whose amount drifted (a re-price through `performUpdate`) is booked at its amount.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createStay, rowOf, liveQuote, save } = require('./ledgerFixture');
const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { runPaymentPoll } = require('../utils/paymentPollRunner');
const { bookPaidAfterAmountChange } = require('../utils/ledgerLinks');
const { recordStayPayment, depsFor } = require('../utils/stayPaymentRecorder');
const { remainingToPay } = require('../utils/reservationSettlement');

const recordReal = (p) => recordStayPayment(depsFor(db), { ...p, keepPaymentOnCaptureFailure: true });
const book = (link) => bookPaidAfterAmountChange({ database: db, recordPayment: recordReal }, link, { paidDay: '2026-10-19' });
const historyOf = (id) => db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id)
  .map((h) => h.changedFields).join(' ');

// The fixture stay: 300 € + 7,20 € tax → acompte 90 €, solde 217,20 €.
test('fixture — acompte 90 €, solde 217,20 €', () => {
  const row = rowOf(createStay());
  assert.deepEqual([row.depositAmount, row.balanceAmount], [90, 217.2]);
});

test('rule 31 — a full link of 250 € paid after the stay grew an acompte: acompte 90 + solde 160 perceived, 57,20 € owed', async () => {
  const id = createStay();
  const booked = book({ reservationId: id, type: 'full', amountCents: 25000 });
  assert.deepEqual([booked.effect, booked.shortfall, booked.excess], ['full-booked', 57.2, 0]);
  let row = rowOf(id);
  assert.deepEqual([row.depositPaid, row.depositAmount, row.balancePaid, row.balanceAmount, row.complementAmount],
    [1, 90, 1, 160, 57.2]);
  assert.equal(remainingToPay(row), 57.2, 'the acompte is never claimed a second time');
  assert.match(historyOf(id), /reste dû après le lien retiré/);
  const res = await save(id, {});
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  row = rowOf(id);
  assert.deepEqual([row.depositAmount, row.balanceAmount, remainingToPay(row)], [90, 160, 57.2], 'a later save keeps it');
});

test('rule 31 — a full link of 400 € paid on a 307,20 € stay: both perceived, 92,80 € trop-perçu, nothing owed', async () => {
  const id = createStay();
  const booked = book({ reservationId: id, type: 'full', amountCents: 40000 });
  assert.deepEqual([booked.effect, booked.excess], ['full-booked', 92.8]);
  const row = rowOf(id);
  assert.deepEqual([row.depositPaid, row.depositAmount, row.balancePaid, row.balanceAmount, remainingToPay(row)],
    [1, 90, 1, 310, 0]);
  const live = await liveQuote(id);
  assert.equal(live.overpaymentTtc, 92.8, 'reservation-refunds rule 34 shows it to refund');
});

test('rule 31 — a full link of 50 € (below the acompte) is booked as the acompte; the solde stays owed', () => {
  const id = createStay();
  const booked = book({ reservationId: id, type: 'full', amountCents: 5000 });
  assert.equal(booked.effect, 'deposit-booked');
  const row = rowOf(id);
  assert.deepEqual([row.depositPaid, row.depositAmount, row.balancePaid, row.balanceAmount, remainingToPay(row)],
    [1, 50, 0, 257.2, 257.2]);
});

test('rule 31 — a retired complement link paid: recorded like the fiche records it, and traced in the history', () => {
  const id = createStay();
  db.prepare('UPDATE reservations SET complementAmount = 30 WHERE id = ?').run(id);
  const booked = book({ reservationId: id, type: 'complement', amountCents: 2400 });
  assert.equal(booked.effect, 'complement-booked');
  const row = rowOf(id);
  assert.deepEqual([row.complementPaid, row.complementPaidDate, row.complementPaidCash, row.complementAmount],
    [1, '2026-10-19', 0, 30]);
  assert.ok(row.arrivalExtrasBaseline, 'the arrival extras baseline is pinned, as on « Marquer perçu »');
  assert.match(historyOf(id), /24,00.*perçus \(payé par un lien retiré\)/);
});

function paidProvider() {
  return {
    id: 'qonto',
    label: 'Qonto',
    isReady: () => true,
    getPayment: async (linkId) => ({ paid: true, paymentId: `pay_${linkId}`, paidAt: '2026-10-05T10:00:00Z' }),
    getLinkStatus: async () => 'open',
    cancelLink: async () => {},
  };
}

let seq = 0;
function openLink(reservationId, type, amountCents) {
  seq += 1;
  return paymentLinksModel.create({ reservationId, type, amountCents, provider: 'qonto', providerLinkId: `mm_${seq}`, url: `https://pay/mm/${seq}` });
}

const poll = () => runPaymentPoll({ database: db, paymentLinksModel, provider: paidProvider(), devisModel, force: true });

test('rule 47 — an open acompte link of 90 € paid after a re-price to 100 € (no HTTP save): booked at 90 €', async () => {
  const id = createStay();
  const link = openLink(id, 'deposit', 9000);
  // A re-price through performUpdate (plugin, SAS) leaves the link open with its old amount.
  db.prepare('UPDATE reservations SET depositAmountOverride = 100, depositAmount = 100, balanceAmount = 207.2 WHERE id = ?').run(id);
  const summary = await poll();
  assert.equal(summary.results.find((r) => r.id === link.id).effect, 'deposit-booked');
  const row = rowOf(id);
  assert.deepEqual([row.depositPaid, row.depositAmount, row.balanceAmount], [1, 90, 217.2],
    'the acompte received is 90 €, never the 100 € the row asked for');
  assert.equal(paymentLinksModel.findById(link.id).status, 'paid');
});

test('rule 47 — an open solde link whose amount still matches is recorded as before', async () => {
  const id = createStay();
  const link = openLink(id, 'balance', 21720);
  const summary = await poll();
  assert.equal(summary.results.find((r) => r.id === link.id).effect, 'balance-marked');
  assert.deepEqual([rowOf(id).balancePaid, rowOf(id).balanceAmount], [1, 217.2]);
});
