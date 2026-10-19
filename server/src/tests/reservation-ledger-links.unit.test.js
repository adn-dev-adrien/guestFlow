// specs/reservation-payment-ledger.md §3.5 — payment links on the ledger rows and what an amount change
// does to them (rules 28-31; §9 Q3 decided 2026-10-19: retire at save, « Renvoyer la demande » on the
// still-due row, a late payment of the old link still recorded at its real amount). A fake provider
// stands in for Qonto: nothing leaves the process.
//
// The same behaviour, from the online-payment side: specs/plugins-phase-3a-online-payment.md rule 26.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createStay, rowOf, liveQuote, save } = require('./ledgerFixture');
const paymentProviders = require('../utils/paymentProviders');
const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { runPaymentPoll } = require('../utils/paymentPollRunner');
const { staleLinks, linkAmountCents } = require('../utils/ledgerLinks');
const { formatEuros: eur } = require('../utils/reservationLedger');

function fakeProvider({ paid = false, down = false } = {}) {
  const calls = [];
  return {
    calls,
    id: 'qonto',
    label: 'Qonto',
    isReady: () => true,
    getPayment: async (linkId) => {
      calls.push(['getPayment', linkId]);
      if (down) throw new Error('provider down');
      return paid ? { paid: true, paymentId: `pay_${linkId}`, paidAt: '2026-10-05T10:00:00Z' } : { paid: false };
    },
    getLinkStatus: async () => { if (down) throw new Error('provider down'); return 'open'; },
    cancelLink: async (linkId) => { calls.push(['cancelLink', linkId]); if (down) throw new Error('provider down'); },
  };
}

function useProvider(provider) {
  paymentProviders.active = () => provider;
  paymentProviders.declared = () => provider;
  paymentProviders.summary = () => (provider ? { provider: provider.id, label: provider.label } : null);
}

let linkSeq = 0;
function openLink(reservationId, type, amountCents) {
  linkSeq += 1;
  return paymentLinksModel.create({ reservationId, type, amountCents, provider: 'qonto', providerLinkId: `pl_${linkSeq}`, url: `https://pay/${linkSeq}` });
}

test('rule 28 — the open link reads on its row; after an amount change « Renvoyer la demande » appears', async () => {
  useProvider(fakeProvider());
  const id = createStay();
  openLink(id, 'deposit', 9000);
  const before = await liveQuote(id);
  const link = before.ledger.rows.find((r) => r.key === 'deposit').detail.link;
  assert.match(link.label, new RegExp(`^Lien envoyé le \\d\\d/\\d\\d(/\\d{4})? · ${eur(90)}$`));
  assert.equal(link.resend, undefined);

  const res = await save(id, { depositAmountOverride: 120 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const after = await liveQuote(id, { depositAmountOverride: 120 });
  const retired = after.ledger.rows.find((r) => r.key === 'deposit').detail.link;
  assert.equal(retired.label, 'Lien retiré · montant modifié');
  assert.deepEqual(retired.resend, { type: 'deposit', label: 'Renvoyer la demande' });
});

test('rule 29 — changing an amount retires its open link and deactivates it at the provider', async () => {
  const provider = fakeProvider();
  useProvider(provider);
  const id = createStay();
  const link = openLink(id, 'deposit', 9000);
  const untouched = openLink(id, 'balance', 21720);
  const res = await save(id, { depositAmountOverride: 100 });
  assert.equal(res.statusCode, 200);
  const row = paymentLinksModel.findById(link.id);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.cancelReason, 'amount-changed');
  assert.equal(row.remoteCancelPendingAt, null, 'deactivated at once');
  assert.ok(provider.calls.some((c) => c[0] === 'cancelLink' && c[1] === link.providerLinkId));
  // The solde moved too (217,20 → 207,20): its link is stale as well.
  assert.equal(paymentLinksModel.findById(untouched.id).cancelReason, 'amount-changed');
});

test('rule 29 — a link whose amount does not change stays open', async () => {
  useProvider(fakeProvider());
  const id = createStay();
  const link = openLink(id, 'deposit', 9000);
  const res = await save(id, { notes: 'rien sur les montants' });
  assert.equal(res.statusCode, 200);
  assert.equal(paymentLinksModel.findById(link.id).status, 'open');
});

test('rule 29 — provider down: retired locally with the remote-deactivation marker, the poll retries', async () => {
  useProvider(fakeProvider({ down: true }));
  const id = createStay();
  const link = openLink(id, 'deposit', 9000);
  const res = await save(id, { depositAmountOverride: 100 });
  assert.equal(res.statusCode, 200, 'the save goes through');
  const row = paymentLinksModel.findById(link.id);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.cancelReason, 'amount-changed');
  assert.ok(row.remoteCancelPendingAt, 'owed to the poll');
});

test('rule 29 — every link type maps to its row amount: deposit, balance, full, complement', () => {
  const row = { depositAmount: 90, balanceAmount: 217.2, finalPrice: 300, complementAmount: 24 };
  assert.deepEqual(['deposit', 'balance', 'full', 'complement'].map((t) => linkAmountCents(t, row)), [9000, 21720, 30000, 2400]);
  const links = [
    { id: 1, type: 'deposit', status: 'open', amountCents: 9000 },
    { id: 2, type: 'balance', status: 'open', amountCents: 20000 },
    { id: 3, type: 'full', status: 'open', amountCents: 31000 },
    { id: 4, type: 'complement', status: 'open', amountCents: 2400 },
    { id: 5, type: 'complement', status: 'paid', amountCents: 1000 },
  ];
  assert.deepEqual(staleLinks(links, row).map((l) => l.id), [2, 3]);
});

test('rule 30 — a link paid before the save wins: 409 LINK_ALREADY_PAID, nothing modified', async () => {
  useProvider(fakeProvider({ paid: true }));
  const id = createStay();
  const link = openLink(id, 'deposit', 9000);
  const res = await save(id, { depositAmountOverride: 100 });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: `Le lien de ${eur(90)} vient d'être payé : montant non modifié.`, code: 'LINK_ALREADY_PAID' });
  assert.equal(rowOf(id).depositAmount, 90, 'the dry run was rolled back');
  assert.equal(rowOf(id).depositAmountOverride, null);
  assert.equal(paymentLinksModel.findById(link.id).status, 'open', 'the poll records the payment as today');
});

async function poll(provider, notified = []) {
  return runPaymentPoll({
    database: db, paymentLinksModel, provider, devisModel, force: true,
    notifyPaidAfterCancel: async (l) => notified.push(l.id),
  });
}

test('rule 31 — deposit link paid after its retirement: the acompte is perceived at the link\'s amount', async () => {
  useProvider(fakeProvider({ down: true }));
  const id = createStay();
  const link = openLink(id, 'deposit', 9000);
  await save(id, { depositAmountOverride: 100 });
  assert.ok(paymentLinksModel.findById(link.id).remoteCancelPendingAt);

  const notified = [];
  const summary = await poll(fakeProvider({ paid: true }), notified);
  const result = summary.results.find((r) => r.id === link.id);
  assert.equal(result.effect, 'deposit-booked');
  const row = rowOf(id);
  assert.deepEqual([row.depositPaid, row.depositAmount, row.depositAmountOverride, row.balanceAmount], [1, 90, 90, 217.2],
    'acompte = 90 € paid by the old link; the solde absorbs the difference');
  assert.equal(paymentLinksModel.findById(link.id).status, 'paid');
  assert.ok(notified.includes(link.id), 'the admin is told, as today');

  const ledger = (await liveQuote(id, { depositAmountOverride: 90 })).ledger;
  assert.equal(ledger.rows.find((r) => r.key === 'deposit').detail.link.label, 'Payé par lien le 05/10/2026 (ancien montant)');
});

test('rule 31 — balance link paid after its retirement: the solde is recorded at the link\'s amount', async () => {
  useProvider(fakeProvider({ down: true }));
  const id = createStay({ depositDisabled: 1 });
  const link = openLink(id, 'balance', 30720);
  await save(id, { depositDisabled: 1, customPrice: 280 });
  assert.equal(paymentLinksModel.findById(link.id).cancelReason, 'amount-changed');
  const summary = await poll(fakeProvider({ paid: true }));
  assert.equal(summary.results.find((r) => r.id === link.id).effect, 'balance-booked');
  const row = rowOf(id);
  assert.deepEqual([row.balancePaid, row.balanceAmount], [1, 307.2]);
});

test('rule 31 — complement link paid after its retirement: recorded, and the row warns about the gap', async () => {
  useProvider(fakeProvider({ down: true }));
  const id = createStay();
  db.prepare('UPDATE reservations SET complementAmount = 30 WHERE id = ?').run(id);
  const link = openLink(id, 'complement', 2400);
  paymentLinksModel.retireForAmountChange(id, 'complement', 3000);
  await poll(fakeProvider({ paid: true }));
  assert.equal(rowOf(id).complementPaid, 1);
  const ledger = (await liveQuote(id, { complementAmountOverride: 30 })).ledger;
  const complement = ledger.rows.find((r) => r.key === 'complement');
  assert.deepEqual(complement.detail.warnings, [{ tone: 'warning', label: `Payé ${eur(24)} par un lien retiré, ${eur(30)} attendus` }]);
  assert.equal(paymentLinksModel.findById(link.id).status, 'paid');
});

test('rule 31 — perceived another way meanwhile: a double payment, nothing recorded, the admin told', async () => {
  useProvider(fakeProvider({ down: true }));
  const id = createStay();
  const link = openLink(id, 'deposit', 9000);
  await save(id, { depositAmountOverride: 100 });
  db.prepare("UPDATE reservations SET depositPaid = 1, depositPaidDate = '2026-10-04' WHERE id = ?").run(id);
  const notified = [];
  const summary = await poll(fakeProvider({ paid: true }), notified);
  const result = summary.results.find((r) => r.id === link.id);
  assert.equal(result.status, 'paid-after-cancel');
  assert.equal(rowOf(id).depositAmount, 100, 'nothing rewritten');
  const stored = paymentLinksModel.findById(link.id);
  assert.equal(stored.status, 'cancelled');
  assert.equal(stored.providerPaymentId, `pay_${link.providerLinkId}`, 'kept for the refund');
  assert.ok(notified.includes(link.id));
});

// Review of #727 (H1) — the old balance link was paid at its old amount: the money received is the
// solde, the rest is owed (arrival complement) or given back (trop-perçu), and a later save keeps it.
const { bookPaidAfterAmountChange } = require('../utils/ledgerLinks');
const { recordStayPayment, depsFor } = require('../utils/stayPaymentRecorder');
const { remainingToPay } = require('../utils/reservationSettlement');
const recordReal = (p) => recordStayPayment(depsFor(db), { ...p, keepPaymentOnCaptureFailure: true });

test('rules 31 + 36 — paid SHORT of the new solde: the shortfall is owed as the arrival complement, and stays owed after a save', async () => {
  const id = createStay({ depositDisabled: 1 });
  const oldCents = Math.round(rowOf(id).balanceAmount * 100); // 307,20 €
  await save(id, { depositDisabled: 1, customPrice: 350 }); // new solde 357,20 €
  const booked = bookPaidAfterAmountChange({ database: db, recordPayment: recordReal },
    { reservationId: id, type: 'balance', amountCents: oldCents }, { paidDay: '2026-10-19' });
  assert.deepEqual([booked.effect, booked.shortfall], ['balance-booked', 50]);
  let row = rowOf(id);
  assert.deepEqual([row.balancePaid, row.balanceAmount, row.complementAmount, remainingToPay(row)], [1, 307.2, 50, 50]);
  const history = db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id).map((h) => h.changedFields).join(' ');
  assert.match(history, /reste dû après le lien retiré/);
  const res = await save(id, { depositDisabled: 1, customPrice: 350 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  row = rowOf(id);
  assert.deepEqual([row.balanceAmount, row.complementAmount, remainingToPay(row)], [307.2, 50, 50],
    'the 50 € never received are never booked as paid');
});

test('rules 31 + 36 — paid ABOVE the new solde: the excess is a trop-perçu, nothing owed', async () => {
  const id = createStay({ depositDisabled: 1 });
  const oldCents = Math.round(rowOf(id).balanceAmount * 100); // 307,20 €
  await save(id, { depositDisabled: 1, customPrice: 280 }); // new solde 287,20 €
  const booked = bookPaidAfterAmountChange({ database: db, recordPayment: recordReal },
    { reservationId: id, type: 'balance', amountCents: oldCents }, { paidDay: '2026-10-19' });
  assert.equal(booked.excess, 20);
  const row = rowOf(id);
  assert.deepEqual([row.balanceAmount, row.complementAmount, remainingToPay(row)], [307.2, 0, 0]);
  const live = await liveQuote(id, { depositDisabled: 1, customPrice: 280 });
  assert.equal(live.overpaymentTtc, 20, 'reservation-refunds rule 34 shows it to refund');
});
