// specs/mixed-method-payments.md rules 54 and 55 (verification R34b: R34b-1, R34b-2, R34b-3), rule 52.
// - R34b-1: rule 52's geste came off the accommodation on the target's FIRST bucket only, and the caisse side read its
//   own share; no test paid a geste over caisse + books on a pool of several buckets, so neither was pinned.
// - R34b-2 (rule 54): a geste larger than what the accommodation holds came off no line, and the live register offered a
//   line refundable above what it collected (forcée 80 for 50 received).
// - R34b-3 (rule 55): the shares of a pool with a caisse share were rounded line by line; the register's lines added up
//   to one cent less than the money received (634,79 for 634,80), and the books kept a cent on 4671 / 4457 after a full
//   refund.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, respond, ADMIN, TODAY, rowOf, mark, NO_ACOMPTE, forced, fiche, register, cancel, giveAll,
} = require('./moneyLedgerFixture');
const { comptaCollected, cashCollected } = require('../utils/reservationSettlement');
const { bucketSharesOf } = require('../utils/paymentTenders');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const { create: createAccountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { entryToStructured } = optionalPlugin(() => require('../plugins/accounting-export/accountingExport'));
const BOOKS = { skip: skipWithout(['accounting-export']) };

const cents = (euros) => Math.round(Number(euros) * 100);
const round2 = (n) => Math.round(n * 100) / 100;
const card = (amountCents) => ({ method: 'card', amountCents, internal: false });
const cashIn = (amountCents) => ({ method: 'cash', amountCents, internal: true });
const sumCents = (values) => values.reduce((total, v) => total + cents(v), 0);

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

// A direct stay without acompte and an 80 € line collected at arrival, paid in ONE go (solde + complement: a pool, rule
// 50) with 200 € in the caisse interne, the rest by card, 50 € short.
function poolWithCaisse(kind) {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(80)] });
  const r0 = rowOf(stay.id);
  const due = cents(r0.balanceAmount) + cents(r0.complementAmount);
  const res = respond();
  controller.settleArrivalPayment({ params: { id: String(stay.id) }, body: {
    mode: 'split', date: TODAY, expectedAmountCents: due, tenders: [cashIn(20000), card(due - 25000)], shortfall: { kind },
  }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return { stay, bookCents: due - 25000, cashCents: 20000 };
}

for (const kind of ['due', 'waived']) {
  test(`rules 52, 55 — a pool caisse 200 + CB + ${kind === 'due' ? 'reste' : 'geste'} 50, cancelled: the register holds the money received to the cent (Q5)`, async () => {
    const { stay, bookCents, cashCents } = poolWithCaisse(kind);
    await cancel(stay.id);
    const reg = register(stay.id);
    assert.equal(cents(comptaCollected(rowOf(stay.id))), bookCents);
    assert.equal(cents(cashCollected(rowOf(stay.id))), cashCents);
    assert.equal(sumCents(reg.refundableLines.map((l) => l.refundableTtc)), bookCents + cashCents, JSON.stringify(reg.refundableLines));
    assert.equal(sumCents(reg.refundableLines.map((l) => l.cashTtc || 0)), cashCents, 'the caisse interne lines add up to 200 €');
  });

  test(`rules 52, 55 — the same pool refunded in full: every account nets to zero, a rounding cent at most between two lines (${kind})`, BOOKS, async () => {
    const { stay } = poolWithCaisse(kind);
    await cancel(stay.id);
    giveAll(stay.id);
    const books = booksOf(stay.id);
    assert.equal(round2(Object.values(books).reduce((sum, v) => sum + v, 0)), 0, JSON.stringify(books));
    for (const [account, net] of Object.entries(books)) {
      if (account === '70600000' || account === '70900000') continue;
      assert.ok(Math.abs(net) <= 0.01, `${account} ${JSON.stringify(books)}`);
    }
    assert.ok(Math.abs(round2((books['70600000'] || 0) + (books['70900000'] || 0))) <= 0.01, JSON.stringify(books));
    if (kind === 'due') assert.deepEqual(books, {}, 'a reste: nothing at all');
  });
}

test('rule 52 — a pool with a geste over caisse + CB, live after 5 % off: the lines answer for the book money, to the cent', async () => {
  const { stay, bookCents } = poolWithCaisse('waived');
  assert.equal((await save(stay, { discountPercent: 5 })).statusCode, 200);
  const r = rowOf(stay.id);
  const lines = register(stay.id).refundableLines;
  assert.equal(cents(comptaCollected(r)), bookCents);
  assert.equal(sumCents(lines.map((l) => l.availableTtc || 0)), bookCents, JSON.stringify(lines));
});

test('rule 52 — a pool paid by card with a geste, live after 5 % off: the geste comes off the accommodation once, the tax and the extra whole (Q13)', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(80)] });
  const r0 = rowOf(stay.id);
  const due = cents(r0.balanceAmount) + cents(r0.complementAmount);
  const res = respond();
  controller.settleArrivalPayment({ params: { id: String(stay.id) }, body: {
    mode: 'split', date: TODAY, expectedAmountCents: due, tenders: [card(due - 5000)], shortfall: { kind: 'waived' },
  }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal((await save(stay, { discountPercent: 5 })).statusCode, 200);
  const r = rowOf(stay.id);
  const lines = register(stay.id).refundableLines;
  const byKey = Object.fromEntries(lines.map((l) => [l.key, l.availableTtc]));
  assert.equal(byKey.touristTax, Number(r.touristTaxTotal), JSON.stringify(lines));
  assert.equal(lines.find((l) => /forc/i.test(l.key)).availableTtc, 80);
  assert.equal(cents(byKey.accommodation), due - 5000 - 8000 - cents(r.touristTaxTotal), 'collected less the extra and the tax');
});

for (const [label, tenders, booksCents] of [['card 50', [card(5000)], 5000], ['caisse 20 + card 30', [cashIn(2000), card(3000)], 3000]]) {
  test(`rule 54 — a complement alone paid with a geste 30 (${label}), solde unpaid: the line offers no more than it collected (Y1)`, () => {
    const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(80)] });
    const m = mark(stay.id, { complementPaid: true, complementPaidDate: TODAY, expectedAmountCents: 8000, tenders, shortfall: { kind: 'waived' } });
    assert.equal(m.statusCode, 200, JSON.stringify(m.body));
    const lines = register(stay.id).refundableLines;
    const forcee = lines.find((l) => /forc/i.test(l.key));
    assert.equal(cents(forcee.availableTtc), booksCents, JSON.stringify(lines));
    assert.equal(sumCents(lines.map((l) => l.availableTtc || 0)), booksCents);
  });
}

test('rule 55 — bucketSharesOf: the geste of each side adds up to the geste left, to the cent', () => {
  const settlement = {
    targetKind: 'bucket', targetKey: 'balance', parts: [{ kind: 'balance', key: 'balance', amountCents: 10001 }],
    tenders: [{ method: 'card', amountCents: 3334, internal: 0 }, { method: 'cash', amountCents: 3333, internal: 1 }],
    shortfallKind: 'waived', shortfallCents: 3334,
  };
  // Cut to 99 €: 101 cents of the geste fall away, the rest is shared between the books and the caisse.
  const shares = bucketSharesOf([settlement], { balanceAmount: 99 });
  assert.equal(cents(shares.balance.waivedBooks) + cents(shares.balance.waivedInternal), 3334 - 101);
});
