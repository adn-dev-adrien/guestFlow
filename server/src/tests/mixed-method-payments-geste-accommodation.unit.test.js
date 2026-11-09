// specs/mixed-method-payments.md rule 52 (audit R34 NEW-3) — a « Geste commercial » left by a payment with several
// methods comes off the ACCOMMODATION only, in the refund register as in the books: the export books the payment's
// lines gross and the geste on 70900000 (rule 18), so `bucketSharesOf` / `collectedByLine` keep the tax and the extras
// at their whole share and take the geste off the accommodation. A cancelled stay refunded in full then nets to zero on
// every account but the geste's own pair (the sale it gave up on 70600000, the rebate on 70900000, which cancel out in the
// result, as before this rule); the tourist tax is never left owed on money given back.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, respond, ADMIN, TODAY, rowOf, mark, NO_ACOMPTE, WITH_ACOMPTE, D, S, fiche, register, cancel, giveAll,
} = require('./moneyLedgerFixture');
const { bucketSharesOf } = require('../utils/paymentTenders');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const { create: createAccountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { entryToStructured } = optionalPlugin(() => require('../plugins/accounting-export/accountingExport'));
const BOOKS = { skip: skipWithout(['accounting-export']) };

const cents = (euros) => Math.round(Number(euros) * 100);
const round2 = (n) => Math.round(n * 100) / 100;
const card = (amountCents) => ({ method: 'card', amountCents, internal: false });
const cashIn = (amountCents) => ({ method: 'cash', amountCents, internal: true });

// Every account this stay moved this month, netted.
function booksOf(id) {
  const [year, month] = TODAY.split('-').map(Number);
  const model = createAccountingModel(db);
  const net = {};
  for (const e of [...model.encaissementsByMonth({ month, year }), ...model.refundsByMonth({ month, year }), ...model.compensationsByMonth({ month, year })]) {
    const rid = Number(e.reservationId || (e.reservation && e.reservation.id));
    if (rid && rid !== Number(id)) continue;
    for (const l of entryToStructured(e).lines) net[l.compte] = round2((net[l.compte] || 0) + Number(l.debit || 0) - Number(l.credit || 0));
  }
  return Object.fromEntries(Object.entries(net).filter(([, v]) => Math.abs(v) >= 0.005));
}

async function save(stay, over) {
  stay.body = { ...stay.body, ...over };
  const res = respond();
  await controller.update({ params: { id: stay.id }, body: { ...stay.body }, user: ADMIN }, res);
  return res;
}

// What the stay leaves on the books once refunded in full: nothing but the geste's 706 / 709 pair (and the VAT cent of
// its rounding), which nets to zero.
function assertRefundedClean(id) {
  const books = booksOf(id);
  const pair = ['70600000', '70900000', '44571100'];
  assert.deepEqual(Object.keys(books).filter((k) => !pair.includes(k)), [], JSON.stringify(books));
  assert.equal(round2(pair.reduce((sum, k) => sum + (books[k] || 0), 0)), 0, JSON.stringify(books));
  assert.ok(Math.abs(books['44571100'] || 0) <= 0.01, JSON.stringify(books));
}

const taxLine = (id) => register(id).refundableLines.find((l) => l.key === 'touristTax');

test('specs/mixed-method-payments.md rule 52 — acompte paid, solde split with a geste, cancelled and refunded in full: no tax left owed (P7)', BOOKS, async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  const bal = cents(rowOf(stay.id).balanceAmount);
  assert.equal(mark(stay.id, { ...S, expectedAmountCents: bal, tenders: [card(bal - 5000)], shortfall: { kind: 'waived' } }).statusCode, 200);
  const tax = Number(rowOf(stay.id).touristTaxTotal);
  await cancel(stay.id);
  assert.equal(taxLine(stay.id).refundableTtc, tax);
  giveAll(stay.id);
  assertRefundedClean(stay.id);
});

for (const kind of ['due', 'waived']) {
  test(`specs/mixed-method-payments.md rule 52 — solde split with a ${kind === 'due' ? 'reste' : 'geste'}, 10 % off, cancelled and refunded in full: no tax left owed (P9)`, BOOKS, async () => {
    const stay = fiche(NO_ACOMPTE, 'direct');
    const bal = cents(rowOf(stay.id).balanceAmount);
    assert.equal(mark(stay.id, { ...S, expectedAmountCents: bal, tenders: [card(bal - 8000)], shortfall: { kind } }).statusCode, 200);
    assert.equal((await save(stay, { discountPercent: 10 })).statusCode, 200);
    await cancel(stay.id);
    giveAll(stay.id);
    assertRefundedClean(stay.id);
  });
}

test('specs/mixed-method-payments.md rule 52 — a geste over caisse + books: each side keeps the tax whole, the geste comes off the accommodation', BOOKS, async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  const bal = cents(rowOf(stay.id).balanceAmount);
  assert.equal(mark(stay.id, { ...S, expectedAmountCents: bal, tenders: [cashIn(10000), card(bal - 15000)], shortfall: { kind: 'waived' } }).statusCode, 200);
  await cancel(stay.id);
  giveAll(stay.id);
  assertRefundedClean(stay.id);
});

test('specs/mixed-method-payments.md rule 52 — bucketSharesOf reads a geste gross and names it apart', () => {
  const settlement = {
    targetKind: 'bucket', targetKey: 'balance', parts: [{ kind: 'balance', key: 'balance', amountCents: 10000 }],
    tenders: [{ method: 'card', amountCents: 6000, internal: 0 }, { method: 'cash', amountCents: 2000, internal: 1 }],
    shortfallKind: 'waived', shortfallCents: 2000,
  };
  const shares = bucketSharesOf([settlement], { balanceAmount: 100 });
  // Books 60 € + its geste share 15 €; caisse 20 € + 5 €; out of 100 €.
  assert.deepEqual(shares.balance, { books: 0.75, internal: 0.25, waivedBooks: 15, waivedInternal: 5 });
});

test('specs/mixed-method-payments.md rule 52 — live stay: the accommodation answers for what it collected net of the geste, the tax whole', () => {
  const { refund } = require('./moneyLedgerFixture');
  const stay = fiche(NO_ACOMPTE, 'direct');
  const bal = cents(rowOf(stay.id).balanceAmount);
  assert.equal(mark(stay.id, { ...S, expectedAmountCents: bal, tenders: [card(bal - 5000)], shortfall: { kind: 'waived' } }).statusCode, 200);
  const lines = register(stay.id).refundableLines;
  const accommodation = lines.find((l) => l.key === 'accommodation');
  const tax = lines.find((l) => l.key === 'touristTax');
  const accommodationTtc = round2(bal / 100 - Number(rowOf(stay.id).touristTaxTotal));
  assert.equal(accommodation.availableTtc, round2(accommodationTtc - 50));
  assert.equal(tax.availableTtc, Number(rowOf(stay.id).touristTaxTotal));
  const over = refund(stay.id, [{ key: 'accommodation', amountTtc: round2(accommodationTtc - 49) }]);
  assert.equal(over.statusCode, 409, JSON.stringify(over.body));
});
