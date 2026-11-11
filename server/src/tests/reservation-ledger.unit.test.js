// specs/reservation-payment-ledger.md — the ledger shaper: rows, order, states, labels, origins and the
// closing « Reste à percevoir » (rules 1-7, 24, 27-28). The server decides every row; these tests pin
// what the fiche will print.

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLedger, formatEuros } = require('../utils/reservationLedger');
const { remainingToPay } = require('../utils/reservationSettlement');

const TODAY = '2026-10-19';
const eur = formatEuros;

// A direct stay of 2027: acompte 252 €, solde 614,40 € (accommodation 840 €, tax 26,40 €).
function directRow(over = {}) {
  return {
    id: 7, kind: 'reservation', platform: 'direct', startDate: '2027-07-22', endDate: '2027-07-29',
    createdAt: '2026-09-02 10:00:00',
    depositAmount: 252, balanceAmount: 614.4, complementAmount: 0, endOfStayComplementAmount: 0,
    depositDueDate: '2026-10-26', balanceDueDate: '2027-06-22',
    depositPaid: 0, depositPaidDate: null, balancePaid: 0, balancePaidDate: null,
    complementPaid: 0, endOfStayComplementPaid: 0,
    cautionReceived: 0, cautionReturned: 0,
    ...over,
  };
}
const directQuote = (over = {}) => ({
  depositAmount: 252, balanceAmount: 614.4, complementAmount: 0, endOfStayComplementTotal: 0,
  preArrivalAmount: 866.4, accommodationPreArrival: 840, autoDepositAmount: 252,
  depositDueDate: '2026-10-26', balanceDueDate: '2027-06-22', platformTakesDeposit: false,
  ...over,
});
const rowOf = (ledger, key) => ledger.rows.find((r) => r.key === key);

test('rule 1 — every row carries its label, amount, state, tone, one action and an amount-edit descriptor', () => {
  const ledger = buildLedger({ row: directRow(), quote: directQuote(), cautionAmount: 400, today: TODAY });
  for (const row of ledger.rows) {
    assert.ok(row.key && row.label, 'key + label');
    assert.ok('amount' in row && 'state' in row && 'tone' in row && 'stateLabel' in row);
    assert.ok(row.action === null || (typeof row.action === 'object' && typeof row.action.label === 'string'), 'at most one action');
    assert.ok(row.amountEdit && 'editable' in row.amountEdit && 'reason' in row.amountEdit, 'rule 3 — amountEdit descriptor');
  }
});

test('rule 2 — rows follow the order money moves; complement/notes/refunds only when they carry money', () => {
  const row = directRow({
    complementAmount: 24, endOfStayComplementAmount: 12,
    midStaySettledNotes: null, cautionReceived: 1, cautionReceivedDate: '2027-07-22',
  });
  const ledger = buildLedger({
    row, quote: directQuote({ complementAmount: 24, endOfStayComplementTotal: 12 }),
    refunds: [{ id: 3, refundDate: '2027-07-30', method: 'transfer', totalTtc: 20, lines: [] }],
    midStayNotes: [{ id: 'n1', total: 15 }],
    cautionAmount: 400, today: TODAY,
  });
  assert.deepEqual(ledger.rows.map((r) => r.key), [
    'deposit', 'balance', 'complement', 'midStayNotes', 'endOfStayComplement', 'refund-3',
    'cautionReceived', 'cautionReturned',
  ]);
  const bare = buildLedger({ row: directRow(), quote: directQuote(), cautionAmount: 400, today: TODAY });
  assert.deepEqual(bare.rows.map((r) => r.key), ['deposit', 'balance', 'cautionReceived', 'cautionReturned'],
    'no complement, no note, no refund row without money');
});

test('rule 4 — due, late, paid and single-payment labels, dates JJ/MM with the year only when it differs', () => {
  const due = buildLedger({ row: directRow(), quote: directQuote(), today: TODAY });
  assert.equal(rowOf(due, 'deposit').stateLabel, 'À percevoir avant le 26/10/2026');
  assert.equal(rowOf(due, 'deposit').tone, 'due');
  assert.equal(rowOf(due, 'balance').stateLabel, 'À percevoir avant le 22/06');

  const late = buildLedger({ row: directRow(), quote: directQuote(), today: '2026-11-02' });
  assert.equal(rowOf(late, 'deposit').state, 'late');
  assert.equal(rowOf(late, 'deposit').stateLabel, 'En retard depuis le 26/10/2026');
  assert.equal(rowOf(late, 'deposit').tone, 'late');

  const paid = buildLedger({ row: directRow({ depositPaid: 1, depositPaidDate: '2026-10-12' }), quote: directQuote(), today: TODAY });
  assert.equal(rowOf(paid, 'deposit').stateLabel, 'Perçu le 12/10/2026');
  assert.equal(rowOf(paid, 'deposit').tone, 'done');

  const group = JSON.stringify({ at: '2027-07-22', cash: 0, total: 866.4, buckets: ['deposit', 'balance'] });
  const single = buildLedger({
    row: directRow({ depositPaid: 1, depositPaidDate: '2027-07-22', balancePaid: 1, balancePaidDate: '2027-07-22', arrivalPaymentGroup: group }),
    quote: directQuote(), today: '2027-07-23',
  });
  assert.equal(rowOf(single, 'deposit').stateLabel, 'Perçu le 22/07 · paiement unique');
  assert.equal(rowOf(single, 'balance').state, 'paid-group');
});

test('rule 4 — the origin of a paid row is what the data knows: link, caisse interne, platform, single payment', () => {
  const link = { id: 1, type: 'deposit', status: 'paid', amountCents: 25200, createdAt: '2026-10-05 08:00:00', paidAt: '2026-10-12T09:00:00Z' };
  const byLink = buildLedger({ row: directRow({ depositPaid: 1, depositPaidDate: '2026-10-12' }), quote: directQuote(), links: [link], today: TODAY });
  assert.equal(rowOf(byLink, 'deposit').stateLabel, 'Perçu le 12/10/2026 · lien de paiement');

  const cash = buildLedger({ row: directRow({ balancePaid: 1, balancePaidCash: 1, balancePaidDate: '2027-07-22' }), quote: directQuote(), today: '2027-07-23' });
  assert.equal(rowOf(cash, 'balance').stateLabel, 'Perçu le 22/07 · caisse interne');

  const none = buildLedger({ row: directRow({ balancePaid: 1, balancePaidDate: '2027-07-22' }), quote: directQuote(), today: '2027-07-23' });
  assert.equal(rowOf(none, 'balance').stateLabel, 'Perçu le 22/07', 'no origin known → nothing');
});

test('rule 5 — « Reste à percevoir » IS reservationSettlement.remainingToPay, and reads « Tout est perçu » at zero', () => {
  const row = directRow({ complementAmount: 24, depositPaid: 1, depositPaidDate: '2026-10-12' });
  const ledger = buildLedger({ row, today: TODAY });
  assert.equal(ledger.remaining, remainingToPay(row));
  assert.equal(ledger.remainingLabel, `Reste à percevoir ${eur(638.4)}`);

  const platform = {
    ...directRow({ platform: 'Booking', depositAmount: 0, balanceAmount: 987.39, platformCommissionAmount: 157.97 }),
  };
  const net = buildLedger({ row: platform, today: TODAY });
  assert.equal(net.remaining, remainingToPay(platform), 'net of the commission of the unsettled échéance');
  assert.equal(net.remaining, 829.42);

  const all = directRow({ depositPaid: 1, depositPaidDate: '2026-10-12', balancePaid: 1, balancePaidDate: '2026-10-15' });
  const done = buildLedger({ row: all, today: TODAY });
  assert.equal(done.remaining, 0);
  assert.equal(done.remainingLabel, 'Tout est perçu');
  assert.equal(done.settled, true);
});

test('rule 6 — rows that do not apply say why, with no input and no action', () => {
  const booking = buildLedger({
    row: directRow({ platform: 'Booking', depositAmount: 0, balanceAmount: 987.39 }),
    quote: directQuote({ depositAmount: 0, balanceAmount: 987.39, platformTakesDeposit: false }),
    live: { platform: 'Booking' }, today: TODAY,
  });
  const dep = rowOf(booking, 'deposit');
  assert.equal(dep.stateLabel, 'Sans objet · Booking encaisse en une fois');
  assert.equal(dep.tone, 'muted');
  assert.equal(dep.action, null);
  assert.equal(dep.amountEdit.editable, false);

  const disabled = buildLedger({ row: directRow({ depositDisabled: 1 }), quote: directQuote({ depositAmount: 0, balanceAmount: 866.4 }), today: TODAY });
  assert.equal(rowOf(disabled, 'deposit').stateLabel, 'Sans objet · acompte désactivé');

  const lastMinute = buildLedger({ row: directRow(), quote: directQuote({ depositAmount: 0, balanceAmount: 866.4 }), today: TODAY });
  assert.equal(rowOf(lastMinute, 'deposit').stateLabel, 'Sans objet · paiement en une fois');

  const noCaution = buildLedger({ row: directRow(), quote: directQuote(), cautionAmount: 0, today: TODAY });
  const caution = rowOf(noCaution, 'caution');
  assert.equal(caution.stateLabel, 'Sans objet');
  assert.equal(caution.action, null);
  assert.equal(rowOf(noCaution, 'cautionReturned'), undefined);
});

test('rule 7 — unpaid rows follow the live quote, paid rows keep the stored amount', () => {
  const row = directRow({ depositPaid: 1, depositPaidDate: '2026-10-12' });
  const ledger = buildLedger({ row, quote: directQuote({ depositAmount: 300, balanceAmount: 700 }), today: TODAY });
  assert.equal(rowOf(ledger, 'deposit').amount, 252, 'paid → stored');
  assert.equal(rowOf(ledger, 'balance').amount, 700, 'unpaid → live');
  assert.equal(ledger.remaining, 700);
});

test('rule 24 — a platform row replaces the solde: « Versement <plateforme> », payout due date, commission and net', () => {
  const row = directRow({
    platform: 'Booking', depositAmount: 0, balanceAmount: 987.39, platformCommissionAmount: 157.97,
    balanceDueDate: '2026-10-22', endDate: '2026-10-12', startDate: '2026-10-05',
  });
  const quote = directQuote({
    depositAmount: 0, balanceAmount: 987.39, platformCommissionAmount: 157.97, acompteCommissionAmount: 0,
    platformNetReceivedAmount: 829.42, balanceDueDate: '2026-10-22', preArrivalAmount: 987.39,
  });
  const ledger = buildLedger({ row, quote, live: { platform: 'Booking' }, today: TODAY });
  const payout = rowOf(ledger, 'balance');
  assert.equal(payout.label, 'Versement Booking');
  assert.equal(payout.stateLabel, 'Attendu le 22/10');
  assert.equal(payout.detail.commission, `Commission ${eur(157.97)} · net ${eur(829.42)}`);
  assert.equal(payout.action.label, 'Marquer reçu');
  assert.equal(payout.amountEdit.mode, 'statement', 'rule 25 — « Modifier » opens the statement fields');

  const late = buildLedger({ row, quote, live: { platform: 'Booking' }, today: '2026-10-25' });
  assert.equal(rowOf(late, 'balance').stateLabel, 'En retard depuis le 22/10');

  const received = buildLedger({ row: { ...row, balancePaid: 1, balancePaidDate: '2026-10-23' }, quote, live: { platform: 'Booking', platformPayoutAmount: 829.42 }, today: TODAY });
  const r = rowOf(received, 'balance');
  assert.equal(r.stateLabel, 'Reçu le 23/10 · Booking');
  assert.equal(r.detail.reconciliation.label, '✓ cohérent avec le virement', 'rule 26 — the reconciliation chip is on the row');
  assert.equal(r.amountEdit.editable, false);

  const withDeposit = buildLedger({
    row: { ...row, platform: 'Airbnb', depositAmount: 300, balanceAmount: 687.39, acompteCommissionAmount: 46.5 },
    quote: { ...quote, depositAmount: 300, balanceAmount: 687.39, acompteCommissionAmount: 46.5, platformTakesDeposit: true },
    live: { platform: 'Airbnb' }, today: TODAY,
  });
  assert.equal(rowOf(withDeposit, 'deposit').detail.commission, `Commission ${eur(46.5)} · net ${eur(253.5)}`,
    'a platform with acompte shows both rows, each with its own commission');
});

test('rule 27 — the ledger never repeats « Net perçu » or « Total du séjour »', () => {
  const ledger = buildLedger({ row: directRow(), quote: directQuote(), cautionAmount: 400, today: TODAY });
  for (const row of ledger.rows) assert.ok(!/Net perçu|Total du séjour/.test(row.label));
});

test('rule 28 — the link shows on its row; « Renvoyer la demande » only while due and once the link is gone', () => {
  const open = { id: 4, type: 'deposit', status: 'open', amountCents: 25200, createdAt: '2026-10-03 09:00:00' };
  const withOpen = buildLedger({ row: directRow(), quote: directQuote(), links: [open], canRequest: true, today: TODAY });
  assert.equal(rowOf(withOpen, 'deposit').detail.link.label, `Lien envoyé le 03/10/2026 · ${eur(252)}`);
  assert.equal(rowOf(withOpen, 'deposit').detail.link.resend, undefined, 'the open link is still the request');

  const retired = { ...open, status: 'cancelled', cancelReason: 'amount-changed' };
  const afterChange = buildLedger({ row: directRow(), quote: directQuote(), links: [retired], canRequest: true, today: TODAY });
  const link = rowOf(afterChange, 'deposit').detail.link;
  assert.equal(link.label, 'Lien retiré · montant modifié');
  assert.deepEqual(link.resend, { type: 'deposit', label: 'Renvoyer la demande' });

  const perceived = buildLedger({
    row: directRow({ depositPaid: 1, depositPaidDate: '2026-10-12' }), quote: directQuote(),
    links: [{ ...open, status: 'cancelled', cancelReason: 'settled' }], canRequest: true, today: TODAY,
  });
  assert.equal(rowOf(perceived, 'deposit').detail.link.label, 'Lien retiré · perçu autrement');
  assert.equal(rowOf(perceived, 'deposit').detail.link.resend, undefined, 'never on a perceived row');

  const full = { id: 9, type: 'full', status: 'paid', amountCents: 86640, createdAt: '2026-10-01 08:00:00', paidAt: '2026-10-05T10:00:00Z' };
  const viaFull = buildLedger({ row: directRow({ balancePaid: 1, balancePaidDate: '2026-10-05' }), quote: directQuote(), links: [full], today: TODAY });
  assert.equal(rowOf(viaFull, 'balance').detail.link.label, 'Payé par lien le 05/10/2026', '`full` links show on the solde');

  const late = { id: 10, type: 'deposit', status: 'paid', cancelReason: 'amount-changed', amountCents: 25200, createdAt: '2026-10-01', paidAt: '2026-10-05T10:00:00Z' };
  const oldAmount = buildLedger({ row: directRow({ depositPaid: 1, depositPaidDate: '2026-10-05' }), quote: directQuote(), links: [late], today: TODAY });
  assert.equal(rowOf(oldAmount, 'deposit').detail.link.label, 'Payé par lien le 05/10/2026 (ancien montant)');
});

test('rule 6 + edge cases — cancelled stay is read-only, a retained acompte reads « Conservé »', () => {
  const ledger = buildLedger({
    row: directRow({ kind: 'cancelled', depositPaid: 1, depositPaidDate: '2026-10-12' }), quote: null, cautionAmount: 400, today: TODAY,
  });
  assert.equal(rowOf(ledger, 'deposit').stateLabel, 'Conservé · indemnité d\'annulation');
  for (const row of ledger.rows) {
    assert.equal(row.action, null, `${row.key} has no action`);
    assert.equal(row.amountEdit.editable, false, `${row.key} is not editable`);
  }
});

test('edge cases — a devis shows planned acompte / solde, no mark, no caution, amounts locked with the reason', () => {
  const ledger = buildLedger({ row: null, quote: directQuote(), live: { kind: 'devis', platform: 'direct' }, cautionAmount: 400, today: TODAY });
  assert.deepEqual(ledger.rows.map((r) => r.key), ['deposit', 'balance']);
  assert.equal(rowOf(ledger, 'deposit').action, null);
  assert.equal(rowOf(ledger, 'deposit').amountEdit.editable, false);
  assert.match(rowOf(ledger, 'balance').amountEdit.reason, /^Sur un devis/);
});

test('edge cases — stored rows breaking the new guards are shown as they are, with a warning', () => {
  const ledger = buildLedger({
    row: directRow({ cautionReturned: 1, cautionReturnedDate: '2026-10-01', depositPaid: 1, depositPaidDate: '2026-12-01' }),
    quote: directQuote(), cautionAmount: 400, today: TODAY,
  });
  assert.deepEqual(rowOf(ledger, 'cautionReturned').detail.warnings.map((w) => w.label), ['Restituée sans réception enregistrée']);
  assert.deepEqual(rowOf(ledger, 'deposit').detail.warnings.map((w) => w.label), ['Date future enregistrée']);
});

test('rule 12 — caution states: « Après réception » until received, then « Restituer »', () => {
  const before = buildLedger({ row: directRow(), quote: directQuote(), cautionAmount: 400, today: TODAY });
  assert.equal(rowOf(before, 'cautionReceived').action.label, 'Recevoir');
  assert.equal(rowOf(before, 'cautionReturned').stateLabel, 'Après réception');
  assert.equal(rowOf(before, 'cautionReturned').action, null);

  const received = buildLedger({ row: directRow({ cautionReceived: 1, cautionReceivedDate: '2027-07-22' }), quote: directQuote(), cautionAmount: 400, today: '2027-07-25' });
  assert.equal(rowOf(received, 'cautionReceived').stateLabel, 'Reçue le 22/07');
  assert.equal(rowOf(received, 'cautionReturned').action.label, 'Restituer');
  assert.equal(rowOf(received, 'cautionReturned').action.after, '2027-07-22');
});

// specs/adjustable-complement-amounts.md rule 9 — a complement adjusted down to 0 € keeps its row,
// otherwise the operator could no longer clear the adjustment.
test('adjustable-complement rule 9 — a complement adjusted to 0 € keeps its row', () => {
  const ledger = buildLedger({ row: directRow({ complementAmountOverride: 0 }), quote: directQuote({ complementAmount: 0 }), today: TODAY });
  const row = rowOf(ledger, 'complement');
  assert.ok(row);
  assert.equal(row.amount, 0);
  assert.equal(row.action, null, 'nothing to mark at 0 €');
});

// Second review of #727 (H-a) — without a commission the expected net is unknown: never prefill the
// transfer with the gross (it would then read « cohérent » with a zero commission).
test('rule 26 — the payout mark carries an expected net only when the commission is known', () => {
  const base = directRow({ platform: 'Booking', depositAmount: 0, balanceAmount: 706, startDate: '2026-10-05' });
  const unknown = buildLedger({ row: base, today: TODAY });
  assert.equal(rowOf(unknown, 'balance').action.payout.expected, null);
  const known = buildLedger({ row: { ...base, platformCommissionAmount: 100 }, today: TODAY });
  assert.equal(rowOf(known, 'balance').action.payout.expected, 606);
});

// Second review of #727 — an unpriced stay closes on « Prix à renseigner », never a green « Tout est perçu ».
test('rule 32 — a stay without a price closes on « Prix à renseigner »', () => {
  const ledger = buildLedger({ row: directRow({ finalPrice: 0, depositAmount: 0, balanceAmount: 0 }), today: TODAY });
  assert.deepEqual(ledger.closing, { label: 'Prix à renseigner', amount: null, tone: 'muted' });
  const priced = buildLedger({ row: directRow({ finalPrice: 300, depositPaid: 1, depositPaidDate: '2026-10-01', balancePaid: 1, balancePaidDate: '2026-10-02' }), today: TODAY });
  assert.deepEqual(priced.closing, { label: 'Tout est perçu', amount: null, tone: 'done' });
});

// Second review of #727 (22278) — a mid-stay sale the live quote no longer carries stays due.
test('rule 40 — while edited, an end-of-stay complement the save would drop stays due, with a warning', () => {
  const row = directRow({ finalPrice: 179, depositDisabled: 1, endOfStayComplementAmount: 50 });
  const ledger = buildLedger({ row, quote: directQuote({ depositAmount: 0, endOfStayComplementTotal: 0 }), live: { depositDisabled: 1 }, today: TODAY });
  const eos = rowOf(ledger, 'endOfStayComplement');
  assert.equal(eos.amount, 50);
  assert.match(eos.detail.warnings[0].label, /retirerait 50,00/);
  assert.ok(ledger.remaining >= 50);
});

test('rule 41 — a paid row carries its date, to propose it again after an undo', () => {
  const ledger = buildLedger({ row: directRow({ depositPaid: 1, depositPaidDate: '2026-03-12' }), quote: directQuote(), today: TODAY });
  assert.equal(rowOf(ledger, 'deposit').paidDate, '2026-03-12');
});
