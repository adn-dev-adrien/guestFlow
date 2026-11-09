// specs/mixed-method-payments.md rule 56 (verification R35 leftovers, R34b-3) — a stay paid with several methods books
// each settlement's share entry by entry (`scaleEntry`) and its refunds line by line from the register: the two rounded
// their cents apart, so a cancelled stay given back in full kept a cent on 4671 against 706 / 706010, and the geste's
// 706 / 709 pair. The refund that gives back the last of the stay's book money now debits what is left on each sale
// account: every account of the stay ends at exactly 0 (INVARIANTS « every 706 / 4457 / 4671 account nets to exactly
// 0 »). Every other refund keeps its lines; a stay without a split payment is not read this way.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, TODAY, rowOf, mark, NO_ACOMPTE, WITH_ACOMPTE, S, D, free, forced, fiche, register, cancel, giveAll, refund,
} = require('./moneyLedgerFixture');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const { create: createAccountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { entryToStructured } = optionalPlugin(() => require('../plugins/accounting-export/accountingExport'));
const BOOKS = { skip: skipWithout(['accounting-export']) };

const cents = (euros) => Math.round(Number(euros) * 100);
const round2 = (n) => Math.round(n * 100) / 100;
const card = (amountCents) => ({ method: 'card', amountCents, internal: false });
const cashIn = (amountCents) => ({ method: 'cash', amountCents, internal: true });

function monthOf() {
  const [year, month] = TODAY.split('-').map(Number);
  return { year, month };
}

const refundEntries = (id) => createAccountingModel(db).refundsByMonth(monthOf()).filter((e) => Number(e.reservationId) === Number(id));

// Every account this stay moved this month, netted.
function booksOf(id) {
  const model = createAccountingModel(db);
  const net = {};
  for (const e of [...model.encaissementsByMonth(monthOf()), ...model.refundsByMonth(monthOf()), ...model.compensationsByMonth(monthOf())]) {
    if (Number(e.reservationId) !== Number(id)) continue;
    const structured = entryToStructured(e);
    assert.ok(structured.balanced, JSON.stringify(structured.lines));
    for (const l of structured.lines) net[l.compte] = round2((net[l.compte] || 0) + Number(l.debit || 0) - Number(l.credit || 0));
  }
  return Object.fromEntries(Object.entries(net).filter(([, v]) => Math.abs(v) >= 0.005));
}

// A solde paid 70,01 € in the caisse interne, the rest by card less a geste of 13,33 €: shares that are not whole cents.
function splitSolde(stay) {
  const bal = cents(rowOf(stay.id).balanceAmount);
  const m = mark(stay.id, { ...S, expectedAmountCents: bal, tenders: [cashIn(7001), card(bal - 7001 - 1333)], shortfall: { kind: 'waived' } });
  assert.equal(m.statusCode, 200, JSON.stringify(m.body));
}

test('rule 56 — acompte kept, solde split with caisse + geste, extras: cancelled and given back in full, every account at exactly 0', BOOKS, async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [free(33.33, 'Panier'), forced(17.77)] });
  assert.equal(mark(stay.id, D).statusCode, 200);
  splitSolde(stay);
  await cancel(stay.id);
  giveAll(stay.id);
  assert.deepEqual(booksOf(stay.id), {});
  const closing = refundEntries(stay.id).filter((e) => e.closing);
  assert.equal(closing.length, 1, 'one refund closes the books');
  assert.ok(closing[0].closing.some((leg) => leg.account === '70900000' && leg.amount < 0), 'the rabais is credited back');
});

test('rule 56 — a partial refund keeps its lines, the one giving back the rest closes the books', BOOKS, async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(33.33, 'Panier')] });
  splitSolde(stay);
  await cancel(stay.id);
  assert.equal(refund(stay.id, [{ key: 'accommodation', amountTtc: 100 }]).statusCode, 201);
  const [first] = refundEntries(stay.id);
  assert.equal(first.closing, undefined, 'money is still on the books: the refund reads its lines');
  const firstRows = entryToStructured(first).lines.filter((l) => l.debit);
  assert.deepEqual(firstRows.map((l) => [l.compte, l.debit]), [['70600000', 90.91], ['44571100', 9.09]]);
  giveAll(stay.id);
  assert.deepEqual(booksOf(stay.id), {});
});

test('rule 56 — a live stay refunded in part after a split payment: no account is closed', BOOKS, () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  splitSolde(stay);
  assert.equal(refund(stay.id, [{ key: 'accommodation', amountTtc: 50 }]).statusCode, 201);
  const entries = refundEntries(stay.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].closing, undefined);
  assert.ok(register(stay.id).refundableLines.length > 0);
});

test('rule 56 — a stay paid with one method is not read this way: its full refund keeps its lines', BOOKS, async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(33.33, 'Panier')] });
  assert.equal(mark(stay.id, S).statusCode, 200);
  await cancel(stay.id);
  giveAll(stay.id);
  assert.ok(refundEntries(stay.id).every((e) => e.closing === undefined));
  assert.deepEqual(booksOf(stay.id), {});
});
