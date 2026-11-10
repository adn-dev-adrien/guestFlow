// specs/payment-schedule-and-cancellation.md rule 61, reading of 2026-11-10 (verification R44 L1) — a caisse-interne acompte kept by a
// cancellation: the caisse-interne refunds made before it are taken from every other caisse money first (a solde, the
// caisse share of a mixed solde, a complement paid in the caisse), the acompte only for what they leave over. Before,
// only a solde paid wholly in the caisse absorbed them: the cancellation notice understated the sum kept.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  respond, rowOf, mark, ADMIN, WITH_ACOMPTE, D, S, C, fiche, refund, register,
} = require('./moneyLedgerFixture');
const cancellationController = require('../controllers/reservationCancellationController');

const cents = (euros) => Math.round(Number(euros) * 100);

async function cancel(id) {
  const res = respond();
  await cancellationController.cancel({ params: { id: String(id) }, body: { reason: 'Test' }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

function inCaisse(id, base, amountCents) {
  const res = mark(id, { ...base, expectedAmountCents: amountCents, tenders: [{ method: 'cash', amountCents, internal: true }] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
}

function caisseAcompteStay(extra) {
  const stay = fiche(WITH_ACOMPTE, 'direct', extra);
  const deposit = cents(rowOf(stay.id).depositAmount);
  inCaisse(stay.id, D, deposit);
  return { stay, deposit };
}

function caisseRefund(id, key, amountTtc) {
  const res = refund(id, [{ key, amountTtc }], 'internal');
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
}

test('rule 61 — a solde paid wholly in the caisse absorbs a caisse refund: the acompte is kept whole', async () => {
  const { stay, deposit } = caisseAcompteStay();
  inCaisse(stay.id, S, cents(rowOf(stay.id).balanceAmount));
  caisseRefund(stay.id, 'accommodation', 50);
  const done = await cancel(stay.id);
  assert.equal(cents(done.keptFromGuest), deposit);
});

test('rule 61 — the caisse share of a mixed solde absorbs a caisse refund: the acompte is kept whole', async () => {
  const { stay, deposit } = caisseAcompteStay();
  const solde = cents(rowOf(stay.id).balanceAmount);
  const res = mark(stay.id, {
    ...S, expectedAmountCents: solde,
    tenders: [{ method: 'cash', amountCents: 10000, internal: true }, { method: 'card', amountCents: solde - 10000, internal: false }],
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  caisseRefund(stay.id, 'accommodation', 50);
  const done = await cancel(stay.id);
  assert.equal(cents(done.keptFromGuest), deposit);
});

test('rule 61 — a complement paid in the caisse absorbs a caisse refund made on it: the acompte is kept whole', async () => {
  const { stay, deposit } = caisseAcompteStay({ customOptions: [{ customKey: 'X', description: 'X', amount: 80, offered: false, inComplement: 1 }] });
  inCaisse(stay.id, C, cents(rowOf(stay.id).complementAmount));
  const key = register(stay.id).refundableLines.find((line) => line.label === 'X').key;
  caisseRefund(stay.id, key, 30);
  const done = await cancel(stay.id);
  assert.equal(cents(done.keptFromGuest), deposit);
});

test('rule 61 — caisse refunds beyond the other caisse money come off the acompte, only for what they leave over', async () => {
  const { stay, deposit } = caisseAcompteStay({ customOptions: [{ customKey: 'Y', description: 'Y', amount: 80, offered: false, inComplement: 1 }] });
  inCaisse(stay.id, C, cents(rowOf(stay.id).complementAmount));
  const key = register(stay.id).refundableLines.find((line) => line.label === 'Y').key;
  caisseRefund(stay.id, key, 80);
  caisseRefund(stay.id, 'accommodation', 20);
  const done = await cancel(stay.id);
  assert.equal(cents(done.keptFromGuest), deposit - 2000);
});

test('rule 61 — no other caisse money: a caisse refund comes off the acompte', async () => {
  const { stay, deposit } = caisseAcompteStay();
  caisseRefund(stay.id, 'accommodation', 30);
  const done = await cancel(stay.id);
  assert.equal(cents(done.keptFromGuest), deposit - 3000);
});
