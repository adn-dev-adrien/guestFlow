// specs/single-payment-from-the-fiche.md rule 9 reading of 2026-11-10 (audit R44-RES-L2) and its class — the fiche
// history wrote the « paiement unique » as « 281.98 € — CB / Chèque le 2026-09-01 — balance, endOfStayComplement »
// beside rows reading « 281,98 € » and « 01/09/2026 », and the cancel entry's figures as « 142.16 ». Every such text
// now reads French amounts, days and bucket names; the rows stored before are read the same way, untouched.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { arrivalPaymentText, coveredText } = require('../utils/arrivalPaymentHistoryText');
const { buildHistoryRows } = require('../utils/reservationAudit');
const { validateRefundPayload, buildRefundableLines } = require('../utils/refunds');
const { todayIso } = require('../utils/localDate');

const dayFr = (iso) => iso.split('-').reverse().join('/');

test('rule 9 reading — a single payment line: French amount, day and bucket names', () => {
  const today = todayIso();
  assert.equal(
    arrivalPaymentText({ total: 281.98, cash: false, date: today, buckets: ['balance', 'endOfStayComplement'] }),
    `281,98 € — CB / Chèque le ${dayFr(today)} — solde, complément de fin de séjour`,
  );
  assert.equal(
    arrivalPaymentText({ total: 250.5, cash: true, date: today, buckets: ['deposit', 'complement'] }),
    `250,50 € — caisse interne le ${dayFr(today)} — acompte, complément d'arrivée`,
  );
  assert.equal(coveredText(['balance', 'complement']), "solde, complément d'arrivée");
});

test('rule 9 reading — a single payment stored before reads French, without « vide »', () => {
  const today = todayIso();
  const { changes } = buildHistoryRows([
    { field: 'arrivalPayment', label: "Paiement unique encaissé à l'arrivée", from: '', to: `281.98 € — CB / Chèque le ${today} — balance, endOfStayComplement` },
    { field: 'arrivalPayment', label: "Paiement unique à l'arrivée", from: '250 € (balance, complement)', to: 'annulé' },
    { field: 'arrivalPaymentAdjustment', label: "Total encaissé à l'arrivée", from: '300 €', to: '281.5 € (réduction 18.5 €)' },
  ]);
  assert.equal(changes[0].fromText, null, 'no « vide → »');
  assert.equal(changes[0].toText, `281,98 € — CB / Chèque le ${dayFr(today)} — solde, complément de fin de séjour`);
  assert.equal(changes[1].fromText, "250 € (solde, complément d'arrivée)");
  assert.equal(changes[1].toText, 'annulé');
  assert.equal(changes[2].toText, '281,50 € (réduction 18,50 €)');
});

test('rule 9 reading — a line written already French passes as it is', () => {
  const { changes } = buildHistoryRows([
    { field: 'arrivalPayment', label: 'x', fromText: null, toText: '12,50 € — CB / Chèque le 01/02/2030 — solde' },
  ]);
  assert.equal(changes[0].toText, '12,50 € — CB / Chèque le 01/02/2030 — solde');
});

test('specs/payment-schedule-and-cancellation.md rules 55, 61 — the cancel entry reads its figures as amounts', () => {
  const { changes } = buildHistoryRows([
    { field: 'retainedDeposit', label: 'Acompte conservé', from: null, to: 142.16 },
    { field: 'writtenOffBalance', label: 'Solde abandonné', from: null, to: 249.79 },
    { field: 'keptFromGuest', label: 'Somme conservée', from: null, to: 180 },
  ]);
  assert.deepEqual(changes.map((row) => row.toText), ['142,16 €', '249,79 €', '180 €']);
});

test('reservation-refunds rule 11 — the stay cap refusal names its amount the French way', () => {
  const stay = { finalPrice: 480.5, touristTaxTotal: 13.2, vatRate: 10, options: [], resources: [] };
  const result = validateRefundPayload({
    refundDate: todayIso(),
    lines: [{ label: 'Geste', bucket: 'options', amountTtc: 100 }],
  }, {
    refundableLines: buildRefundableLines({ ...stay, refunds: [] }),
    finalPrice: stay.finalPrice,
    touristTaxTotal: stay.touristTaxTotal,
    alreadyRefundedTotal: 400,
    vatRate: 10,
    today: todayIso(),
  });
  assert.equal(result.code, 'REFUND_EXCEEDS_STAY');
  assert.match(result.message || result.error, /\(493,70 €\)/);
});
