// specs/mixed-method-payments.md rule 57 (verification R35b, finding 1) — an acompte paid by card, a solde paid with
// several methods (part in the caisse interne, part a geste), everything on the books given back while the stay is live,
// THEN the stay cancelled. The cancellation read the solde gross, so the solde absorbed caisse and geste money it never
// put on the books, and the acompte kept the difference as a 7588 indemnity: phantom revenue, and the caisse money
// stranded off the register. It now reads the solde's book share: nothing is retained, the books are empty, and the
// caisse lines still offer the caisse money.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, TODAY, rowOf, mark, NO_ACOMPTE, WITH_ACOMPTE, S, D, free, forced, fiche, register, cancel, refund,
} = require('./moneyLedgerFixture');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const { create: createAccountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { entryToStructured } = optionalPlugin(() => require('../plugins/accounting-export/accountingExport'));
const BOOKS = { skip: skipWithout(['accounting-export']) };

const cents = (euros) => Math.round(Number(euros) * 100);
const round2 = (n) => Math.round(n * 100) / 100;
const card = (amountCents) => ({ method: 'card', amountCents, internal: false });
const cashIn = (amountCents) => ({ method: 'cash', amountCents, internal: true });
const [YEAR, MONTH] = TODAY.split('-').map(Number);

function booksOf(id) {
  const model = createAccountingModel(db);
  const month = { month: MONTH, year: YEAR };
  const net = {};
  for (const e of [...model.encaissementsByMonth(month), ...model.refundsByMonth(month), ...model.compensationsByMonth(month)]) {
    if (Number(e.reservationId) !== Number(id)) continue;
    const structured = entryToStructured(e);
    assert.ok(structured.balanced, JSON.stringify(structured.lines));
    for (const l of structured.lines) net[l.compte] = round2((net[l.compte] || 0) + Number(l.debit || 0) - Number(l.credit || 0));
  }
  return Object.fromEntries(Object.entries(net).filter(([, v]) => Math.abs(v) >= 0.005));
}

const retained = (id) => db.prepare("SELECT totalTtc FROM reservation_refunds WHERE reservationId = ? AND method = 'retained'").all(id);
const cashOffered = (id) => round2(register(id).refundableLines.reduce((sum, l) => sum + Number(l.cashTtc || 0), 0));

// Every book line the live register offers, given back by transfer.
function giveBackLive(id) {
  const lines = register(id).refundableLines
    .map((l) => ({ key: l.key, amountTtc: round2(l.availableTtc ?? l.refundableTtc) }))
    .filter((l) => l.amountTtc > 0);
  const res = refund(id, lines);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
}

function splitSolde(id, caisse, geste) {
  const bal = cents(rowOf(id).balanceAmount);
  const tenders = [];
  if (caisse) tenders.push(cashIn(caisse));
  tenders.push(card(bal - caisse - geste));
  const m = mark(id, { ...S, expectedAmountCents: bal, tenders, shortfall: geste ? { kind: 'waived' } : undefined });
  assert.equal(m.statusCode, 200, JSON.stringify(m.body));
}

for (const [label, caisse, geste] of [['caisse share', 7001, 0], ['geste', 0, 1333], ['caisse share and geste', 7001, 1333]]) {
  test(`rule 57 — acompte + solde split (${label}), live full refund then cancel: nothing retained, books empty, caisse still offered`, BOOKS, async () => {
    const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [free(33.33, 'Panier')] });
    assert.equal(mark(stay.id, D).statusCode, 200);
    splitSolde(stay.id, caisse, geste);
    giveBackLive(stay.id);
    await cancel(stay.id);
    assert.deepEqual(retained(stay.id), [], 'no indemnity: every book euro went back');
    assert.deepEqual(booksOf(stay.id), {});
    assert.equal(cashOffered(stay.id), caisse / 100, 'the caisse money is still offered in the caisse');
  });
}

test('rule 57 — the same stay with extras on both sides (a forced extra rides the complement): nothing retained, books empty', BOOKS, async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [free(21.11, 'Panier'), forced(17.77)] });
  assert.equal(mark(stay.id, D).statusCode, 200);
  splitSolde(stay.id, 4999, 2222);
  giveBackLive(stay.id);
  await cancel(stay.id);
  assert.deepEqual(retained(stay.id), []);
  assert.deepEqual(booksOf(stay.id), {});
  assert.equal(cashOffered(stay.id), 49.99);
});

test('rule 57 — a live refund of part only, then cancel: the acompte keeps what the solde\'s book share could not absorb', BOOKS, async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  const deposit = Number(rowOf(stay.id).depositAmount);
  splitSolde(stay.id, 7001, 1333);
  assert.equal(refund(stay.id, [{ key: 'accommodation', amountTtc: 100 }]).statusCode, 201);
  await cancel(stay.id);
  // 100 € given back is far below the solde's book share: the solde absorbs it whole, the acompte is kept whole.
  assert.deepEqual(retained(stay.id).map((r) => r.totalTtc), [deposit]);
});

test('rule 57 — a solde with no split keeps its whole reading (one method, no acompte touched)', BOOKS, async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(33.33, 'Panier')] });
  assert.equal(mark(stay.id, S).statusCode, 200);
  giveBackLive(stay.id);
  await cancel(stay.id);
  assert.deepEqual(retained(stay.id), []);
});

test('rule 57 — a geste larger than the solde\'s accommodation share (the card pays 5 €, extras on the solde): nothing retained, books empty', BOOKS, async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [free(33.33, 'Panier'), forced(17.77)] });
  assert.equal(mark(stay.id, D).statusCode, 200);
  splitSolde(stay.id, 0, cents(rowOf(stay.id).balanceAmount) - 500);
  giveBackLive(stay.id);
  await cancel(stay.id);
  assert.deepEqual(retained(stay.id), [], 'the geste reaches past the accommodation into the extras, never into the acompte');
  assert.deepEqual(booksOf(stay.id), {});
});
