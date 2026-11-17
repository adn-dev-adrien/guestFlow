// specs/mollie-rolling-reserve-and-incoming-payments.md rules 4, 5, 10, 16 — what a Mollie settlement paid, read EXACTLY
// from the primary balance's transactions (measured on the live account, 2026-11-16): the `payment` and
// `api-payment-rolling-reserve-release` transactions between two `outgoing-transfer`s are one settlement. No network:
// the Mollie client is a fake. Names and ids are fictitious; the amounts and dates of the measured cases are real.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSettlement, readBalanceTransaction } = require('../mollieClient');
const { normalizeReference, createSettlementsModel, syncSettlements } = require('../reconciliation/mollieSettlements');
const { createSplitsModel } = require('../reconciliation/molliePaymentSplits');
const { createMollieConnection } = require('../mollieConnection');
const { db, dayAt, build, reset, paidStay, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => { reset(); });

const START = dayAt(-140);
const amount = (value) => ({ value, currency: 'EUR' });
const line = (description, value, method = null) => ({ description, method, amountGross: amount(value) });
const apiTx = (id, type, createdAt, result, initial, deductions, context) => ({
  id, type, createdAt, resultAmount: amount(result), initialAmount: amount(initial), deductions: deductions == null ? null : amount(deductions), context,
});
const at = (day, time = '12:00:00') => `${day}T${time}+00:00`;

/** A Mollie that answers from tables; it fails the test if the settlement's payments list is read when it must not be. */
function fakeMollie({ settlements, balance, payments = {}, balanceFails = false }) {
  const calls = { settlementPayments: 0, getPayment: [] };
  return {
    calls,
    getSettlement: async (reference) => settlements[reference],
    listBalanceTransactions: async () => {
      if (balanceFails) { const err = new Error('no'); err.status = 403; throw err; }
      return balance.map(readBalanceTransaction);
    },
    listSettlementPayments: async (id) => { calls.settlementPayments += 1; return payments[`settlement:${id}`] || []; },
    getPayment: async (id) => { calls.getPayment.push(id); return payments[id]; },
  };
}
const mollieSettlement = (over) => ({ settledAt: null, amountCents: 0, costsCents: 0, reserveHeldCents: 0, reserveReleasedCents: 0, ...over });
const mollieOwn = (id, cents, description, over = {}) => ({ id, amountCents: cents, refundedCents: 0, description, paidAt: null, settlementId: null, paymentLinkId: null, ...over });
const everyItem = (controller) => ['todo', 'waiting', 'done'].flatMap((view) => controller.list({ view }).body.items);
const splitSettings = { get: (k) => ({ reconciliationStartDate: START }[k] || '') };

test('rule 16 — the bank prints « REF T19274230.2611.01 », Mollie knows « 19274230.2611.01 »: both forms are the same settlement', async () => {
  assert.equal(normalizeReference('REF T19274230.2611.01'), '19274230.2611.01');
  assert.equal(normalizeReference('T19274230.2611.01'), '19274230.2611.01');
  assert.equal(normalizeReference('19274230.2611.01'), '19274230.2611.01');
  assert.equal(normalizeReference('Tarif'), 'Tarif', 'only a T followed by a digit is the bank prefix');
  const asked = [];
  const mollie = { getSettlement: async (reference) => { asked.push(reference); return mollieSettlement({ id: 'stl_a', reference }); }, listSettlementPayments: async () => [] };
  const model = createSettlementsModel(db);
  const credits = [mollieCredit('c1', 1120, 4, { reference: 'REF T19274230.2611.01' })];
  await syncSettlements({ client: mollie, model, splits: createSplitsModel(db), credits, links: [] });
  assert.deepEqual(asked, ['19274230.2611.01']);
  assert.equal(model.hasReference('REF T19274230.2611.01'), true);
  assert.equal(model.hasReference('19274230.2611.01'), true);
  assert.deepEqual([...model.byReference().keys()], ['19274230.2611.01']);
  await syncSettlements({ client: mollie, model, splits: createSplitsModel(db), credits: [mollieCredit('c2', 1120, 4, { reference: '19274230.2611.01' })], links: [] });
  assert.equal(asked.length, 1, 'the bare form is already stored');
});

test('rules 5 and 16 — the settlements measured on the live account: amount = revenue − costs, the reserve lines told by description, the fee discount cancels the fees', () => {
  const periods = (year, month, revenue, costs) => ({ [year]: { [month]: { revenue, costs } } });
  const card = (v) => line('Cards - Online - Cartes Bancaires Consumer', v, 'creditcard');
  const measured = [
    ['stl_aaaa11', '19274230.2611.01', '11.20', periods(2026, '11', [card('14.0000'), line('Rolling Reserve Reservation', '-2.8000')],
      [card('0.4460'), line('Fee Discount', '-0.4460'), line('Rounding differences', '0.0000')]), { costs: 0, held: 280, released: 0 }],
    ['stl_bbbb22', '19274230.2610.01', '585.92', periods(2026, '10', [card('732.4000'), line('Rolling Reserve Reservation', '-146.4800')],
      [card('11.2360'), line('Fee Discount', '-11.2360')]), { costs: 0, held: 14648, released: 0 }],
    ['stl_cccc33', '19274230.2603.01', '39.36', periods(2025, '12', [line('Rolling Reserve Release', '39.3600')], []), { costs: 0, held: 0, released: 3936 }],
    ['stl_dddd44', '19274230.2512.01', '157.44', periods(2025, '12', [card('196.8000'), line('Rolling Reserve Reservation', '-39.3600')],
      [card('3.0052'), line('Fee Discount', '-3.0052')]), { costs: 0, held: 3936, released: 0 }],
  ];
  measured.forEach(([id, reference, value, periodsOf, expected]) => {
    const read = readSettlement({ id, reference, amount: amount(value), periods: periodsOf });
    assert.equal(read.costsCents, expected.costs, `${reference}: fees are cancelled by « Fee Discount »`);
    assert.equal(read.reserveHeldCents, expected.held, `${reference}: hold`);
    assert.equal(read.reserveReleasedCents, expected.released, `${reference}: release`);
  });
  const withFees = readSettlement({ id: 's', reference: 'r', amount: amount('9.00'), periods: periods(2026, '12', [card('10.0000')], [card('1.0000')]) });
  assert.equal(withFees.costsCents, 100, 'without a discount the card cost is the fee');
});

// date-literal-ok: the balance of the live account, measured 2026-11-16 (ids are fictitious)
const MEASURED = [
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  apiTx('bt_01', 'outgoing-transfer', at('2026-11-10', '05:11:00'), '-11.20', '-11.20', null, { settlementId: 'stl_aaaa11', transferId: 'trf_a' }),
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  apiTx('bt_02', 'payment', at('2026-11-09', '16:10:00'), '11.20', '14.00', '-2.80', { paymentId: 'tr_gruatA', paymentDescription: 'F-2026-013' }),
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  apiTx('bt_03', 'outgoing-transfer', at('2026-10-29', '05:10:00'), '-585.92', '-585.92', null, { settlementId: 'stl_bbbb22' }),
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  apiTx('bt_04', 'payment', at('2026-10-28', '17:57:00'), '585.92', '732.40', '-146.48', { paymentId: 'tr_linkB', paymentDescription: 'qonto-payment-b' }),
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  apiTx('bt_05', 'outgoing-transfer', at('2026-03-23', '05:16:00'), '-39.36', '-39.36', null, { settlementId: 'stl_cccc33' }),
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  apiTx('bt_06', 'api-payment-rolling-reserve-release', at('2026-03-20', '12:26:00'), '39.36', '39.36', null, { paymentId: 'tr_invD', paymentDescription: 'F-2025-016' }),
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  apiTx('bt_07', 'outgoing-transfer', at('2025-12-23', '05:15:00'), '-157.44', '-157.44', null, { settlementId: 'stl_dddd44' }),
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  apiTx('bt_08', 'payment', at('2025-12-22', '12:26:00'), '157.44', '196.80', '-39.36', { paymentId: 'tr_invD', paymentDescription: 'F-2025-016' }),
];

test('rule 10 — the four measured settlements are each composed exactly from the balance transactions between two outgoing transfers', () => {
  const model = createSettlementsModel(db);
  model.storeBalanceTransactions(MEASURED.map(readBalanceTransaction));
  const composed = (id) => (model.compositionOf(id) || []).map((t) => [t.type, t.paymentId, t.resultCents]);
  assert.deepEqual(composed('stl_aaaa11'), [['payment', 'tr_gruatA', 1120]]);
  assert.deepEqual(composed('stl_bbbb22'), [['payment', 'tr_linkB', 58592]]);
  assert.deepEqual(composed('stl_cccc33'), [['api-payment-rolling-reserve-release', 'tr_invD', 3936]], 'a release alone in its settlement');
  assert.deepEqual(composed('stl_dddd44'), [['payment', 'tr_invD', 15744]], 'the oldest settlement: everything before its transfer');
  assert.equal(model.compositionOf('stl_unknown'), null);
  const gross = readBalanceTransaction(MEASURED[3]);
  assert.deepEqual([gross.resultCents, gross.initialCents, gross.deductionsCents], [58592, 73240, 14648], 'deductions are the reserve held, as a positive amount');
});

test('rule 10 — a settlement of two immediate shares and one release is allocated tranche by tranche, « sûr », and the release is linked by its payment id', async () => {
  const a = paidStay({ cents: 10000, daysAgo: 6, providerPaymentId: 'qonto-a' });
  const b = paidStay({ cents: 20000, daysAgo: 6, clientId: 2, providerPaymentId: 'qonto-b' });
  const c = paidStay({ cents: 15000, daysAgo: 96, providerPaymentId: 'qonto-c' });
  const splits = createSplitsModel(db);
  splits.sync({ settings: splitSettings });
  const day = (n) => dayAt(n);
  const balance = [
    apiTx('t1', 'outgoing-transfer', at(day(-30), '05:00:00'), '-50.00', '-50.00', null, { settlementId: 'stl_prev' }),
    apiTx('t2', 'payment', at(day(-40), '10:00:00'), '50.00', '60.00', '-10.00', { paymentId: 'tr_old', paymentDescription: 'old' }),
    apiTx('t3', 'payment', at(day(-2), '16:00:00'), '80.00', '100.00', '-20.00', { paymentId: 'tr_a', paymentDescription: 'qonto-a' }),
    apiTx('t4', 'payment', at(day(-2), '16:05:00'), '160.00', '200.00', '-40.00', { paymentId: 'tr_b', paymentDescription: 'qonto-b' }),
    apiTx('t5', 'api-payment-rolling-reserve-release', at(day(-3), '12:00:00'), '30.00', '30.00', null, { paymentId: 'tr_c', paymentDescription: 'qonto-c' }),
    apiTx('t6', 'outgoing-transfer', at(day(-1), '05:00:00'), '-270.00', '-270.00', null, { settlementId: 'stl_grp' }),
  ];
  const mollie = fakeMollie({
    settlements: { '19274230.2611.05': mollieSettlement({ id: 'stl_grp', reference: '19274230.2611.05', amountCents: 27000, reserveHeldCents: 6000 }) },
    balance,
    payments: { tr_a: mollieOwn('tr_a', 10000, 'qonto-a'), tr_b: mollieOwn('tr_b', 20000, 'qonto-b'), tr_c: mollieOwn('tr_c', 15000, 'qonto-c') },
  });
  const credits = [mollieCredit('grp', 27000, 1, { reference: 'REF T19274230.2611.05' })];
  const { controller, transactions } = build({ startDate: START });
  transactions.upsertMany(credits, { bankAccountId: 'acc-1' });
  const result = await syncSettlements({ client: mollie, model: createSettlementsModel(db), splits, credits, links: db.prepare("SELECT * FROM payment_links WHERE status = 'paid'").all() });
  assert.deepEqual(result, { read: 1, unknownPayments: 0, balances: true, failed: [] });
  assert.equal(mollie.calls.settlementPayments, 0, 'the settlement\'s payments list is only the fallback');
  assert.equal(splits.forLink(c.link.id).molliePaymentId, 'tr_c', 'the release carries the payment it frees');

  const detail = createSettlementsModel(db).byReference().get('19274230.2611.05');
  assert.equal(detail.source, 'balance');
  assert.deepEqual(detail.payments.map((p) => [p.molliePaymentId, p.kind, p.amountCents]).sort(), [['tr_a', 'immediate', 8000], ['tr_b', 'immediate', 16000], ['tr_c', 'release', 3000]]);

  const item = everyItem(controller).find((i) => i.proposal && i.proposal.bank.transactionId === 'grp');
  assert.equal(item.proposal.confidence, 'sur');
  assert.deepEqual(item.proposal.allocations.map((al) => [al.reservationId, al.ledgerKey, al.amountCents]).sort(),
    [[a.reservationId, 'balance#immediat', 8000], [b.reservationId, 'balance#immediat', 16000], [c.reservationId, 'balance#retenue', 3000]].sort());
});

test('rule 10 — a reserve released ALONE in its settlement is one « sûr » tranche (measured: 39,36 € of 20 March)', async () => {
  const d = paidStay({ cents: 19680, daysAgo: 96, providerPaymentId: 'qonto-d' });
  const splits = createSplitsModel(db);
  splits.sync({ settings: splitSettings });
  const mollie = fakeMollie({
    settlements: { '19274230.2603.01': mollieSettlement({ id: 'stl_c', reference: '19274230.2603.01', amountCents: 3936, reserveReleasedCents: 3936 }) },
    balance: [
      apiTx('r1', 'api-payment-rolling-reserve-release', at(dayAt(-3)), '39.36', '39.36', null, { paymentId: 'tr_d', paymentDescription: 'qonto-d' }),
      apiTx('r2', 'outgoing-transfer', at(dayAt(-2), '05:16:00'), '-39.36', '-39.36', null, { settlementId: 'stl_c' }),
    ],
    payments: { tr_d: mollieOwn('tr_d', 19680, 'qonto-d') },
  });
  const credits = [mollieCredit('rel', 3936, 2, { reference: 'REF T19274230.2603.01' })];
  const { controller, transactions } = build({ startDate: START });
  transactions.upsertMany(credits, { bankAccountId: 'acc-1' });
  await syncSettlements({ client: mollie, model: createSettlementsModel(db), splits, credits, links: db.prepare("SELECT * FROM payment_links WHERE status = 'paid'").all() });
  const item = everyItem(controller).find((i) => i.proposal && i.proposal.bank.transactionId === 'rel');
  assert.equal(item.proposal.confidence, 'sur');
  assert.deepEqual(item.proposal.allocations.map((al) => [al.reservationId, al.ledgerKey, al.amountCents]), [[d.reservationId, 'balance#retenue', 3936]]);
});

test('rule 5 — the fee discount cancels the fees: the settlement is explained with 0 € of fees, not the 1,4 % + 0,25 € estimate', async () => {
  const e = paidStay({ cents: 73240, daysAgo: 6, providerPaymentId: 'qonto-e' });
  const splits = createSplitsModel(db);
  splits.sync({ settings: splitSettings });
  const periods = { 2026: { 11: {
    revenue: [line('Cards - Online - Cartes Bancaires Consumer', '732.4000', 'creditcard'), line('Rolling Reserve Reservation', '-146.4800')],
    costs: [line('Cards - Online - Cartes Bancaires Consumer', '11.2360', 'creditcard'), line('Fee Discount', '-11.2360')],
  } } };
  const mollie = fakeMollie({
    settlements: { '19274230.2610.01': { ...readSettlement({ id: 'stl_e', reference: '19274230.2610.01', amount: amount('585.92'), periods }) } },
    balance: [
      apiTx('e1', 'payment', at(dayAt(-3)), '585.92', '732.40', '-146.48', { paymentId: 'tr_e', paymentDescription: 'qonto-e' }),
      apiTx('e2', 'outgoing-transfer', at(dayAt(-2), '05:10:00'), '-585.92', '-585.92', null, { settlementId: 'stl_e' }),
    ],
    payments: { tr_e: mollieOwn('tr_e', 73240, 'qonto-e') },
  });
  const credits = [mollieCredit('c1', 58592, 2, { reference: 'REF T19274230.2610.01' })];
  const { controller, transactions } = build({ startDate: START });
  transactions.upsertMany(credits, { bankAccountId: 'acc-1' });
  const model = createSettlementsModel(db);
  await syncSettlements({ client: mollie, model, splits, credits, links: db.prepare("SELECT * FROM payment_links WHERE status = 'paid'").all() });
  assert.equal(model.byReference().get('19274230.2610.01').costsCents, 0);
  assert.equal(model.realFees().get(`link:${e.link.id}`), 0, 'the real fee replaces the estimate');
  const item = everyItem(controller).find((i) => i.proposal && i.proposal.bank.transactionId === 'c1');
  assert.equal(item.proposal.confidence, 'sur');
  assert.deepEqual(item.proposal.allocations.map((al) => al.amountCents), [58592], 'the whole immediate share, no fee taken off it');
  assert.doesNotMatch(item.proposal.reason, /frais/i);
  const immediate = everyItem(controller).find((i) => i.ledgerKey === 'balance#immediat');
  assert.equal(immediate.expectedCents, 58592);
});

test('rule 4 — the reserve Mollie really held (the payment\'s deductions) corrects the stored split; a fee is taken off first, an unknown fee leaves the split alone', async () => {
  const f = paidStay({ cents: 10000, daysAgo: 6, providerPaymentId: 'qonto-f' });
  const g = paidStay({ cents: 10000, daysAgo: 6, clientId: 2, providerPaymentId: 'qonto-g' });
  const h1 = paidStay({ cents: 10000, daysAgo: 6, providerPaymentId: 'qonto-h1' });
  const h2 = paidStay({ cents: 10000, daysAgo: 6, clientId: 2, providerPaymentId: 'qonto-h2' });
  const splits = createSplitsModel(db);
  splits.sync({ settings: splitSettings });
  assert.equal(splits.forLink(f.link.id).reserveCents, 2000, 'computed from the 20 % rate');
  const links = () => db.prepare("SELECT * FROM payment_links WHERE status = 'paid'").all();
  const run = (id, reference, balance, payments, costsCents = 0) => syncSettlements({
    client: fakeMollie({ settlements: { [reference]: mollieSettlement({ id, reference, costsCents }) }, balance, payments }),
    model: createSettlementsModel(db), splits, credits: [mollieCredit(`c-${id}`, 100, 1, { reference: `REF T${reference}` })], links: links(),
  });
  // Each round pays on its own day and is transferred the day after, so the three settlements never share a transaction.
  const tx = (n, cents, deductions, paymentId, description, ago) => apiTx(`x${n}`, 'payment', at(dayAt(-ago), `1${n}:00:00`), String((cents - deductions) / 100), String(cents / 100), String(-deductions / 100), { paymentId, paymentDescription: description });
  const transfer = (n, id, ago) => apiTx(`y${n}`, 'outgoing-transfer', at(dayAt(-ago), '05:00:00'), '-1.00', '-1.00', null, { settlementId: id });

  // 25 % held, no fee: the hold is the whole of the deductions.
  await run('stl_f', '19274230.2611.11', [tx(1, 10000, 2500, 'tr_f', 'qonto-f', 9), transfer(1, 'stl_f', 8)], { tr_f: mollieOwn('tr_f', 10000, 'qonto-f') });
  assert.deepEqual([splits.forLink(f.link.id).reserveCents, splits.forLink(f.link.id).immediateCents], [2500, 7500]);

  // 20 % held and 0,45 € of fees on one payment: the fee comes off the deductions before the reserve is known.
  await run('stl_g', '19274230.2611.12', [tx(2, 10000, 2045, 'tr_g', 'qonto-g', 7), transfer(2, 'stl_g', 6)], { tr_g: mollieOwn('tr_g', 10000, 'qonto-g') }, 45);
  assert.deepEqual([splits.forLink(g.link.id).reserveCents, splits.forLink(g.link.id).immediateCents], [2000, 8000]);
  assert.equal(createSettlementsModel(db).realFees().get(`link:${g.link.id}`), 45);

  // Two payments, some cost: which one bore it is unknown — the splits stay as computed, the fee stays an estimate.
  await run('stl_h', '19274230.2611.13', [tx(3, 10000, 2030, 'tr_h1', 'qonto-h1', 5), tx(4, 10000, 2030, 'tr_h2', 'qonto-h2', 5), transfer(3, 'stl_h', 4)],
    { tr_h1: mollieOwn('tr_h1', 10000, 'qonto-h1'), tr_h2: mollieOwn('tr_h2', 10000, 'qonto-h2') }, 60);
  assert.equal(splits.forLink(h1.link.id).reserveCents, 2000);
  assert.equal(splits.forLink(h2.link.id).reserveCents, 2000);
  assert.equal(createSettlementsModel(db).realFees().has(`link:${h1.link.id}`), false);
});

test('rule 16 — a token that cannot read the balance falls back on the settlement\'s payments list, and says nothing is composed', async () => {
  paidStay({ cents: 10000, daysAgo: 6, providerPaymentId: 'qonto-i' });
  const splits = createSplitsModel(db);
  splits.sync({ settings: splitSettings });
  const mollie = fakeMollie({
    settlements: { '19274230.2611.21': mollieSettlement({ id: 'stl_i', reference: '19274230.2611.21', amountCents: 8000 }) },
    balance: [], balanceFails: true,
    payments: { 'settlement:stl_i': [mollieOwn('tr_i', 10000, 'qonto-i')] },
  });
  const model = createSettlementsModel(db);
  const result = await syncSettlements({
    client: mollie, model, splits, credits: [mollieCredit('c1', 8000, 1, { reference: 'REF T19274230.2611.21' })],
    links: db.prepare("SELECT * FROM payment_links WHERE status = 'paid'").all(),
  });
  assert.deepEqual(result, { read: 1, unknownPayments: 0, balances: false, failed: [] });
  assert.equal(mollie.calls.settlementPayments, 1);
  assert.equal(model.byReference().get('19274230.2611.21').source, 'payments');
});

test('rule 14 — the connection shows what Mollie still holds: the pending amount of the primary balance, never the token', async () => {
  const store = new Map([['mollieAccessToken', 'access_FAKE_TOKEN_FOR_TESTS']]);
  const settings = { get: (k) => store.get(k) || '', set: (k, v) => store.set(k, v) };
  const connection = createMollieConnection({
    settings, db, settlements: createSettlementsModel(db),
    buildClient: () => ({ getBalance: async () => ({ pendingCents: 14928, availableCents: 0 }), getSettlement: async () => { throw new Error('none expected'); } }),
  });
  await connection.sync({ credits: [], splits: createSplitsModel(db) });
  const status = connection.status();
  assert.deepEqual([status.balance.pendingCents, status.balance.pendingAmount, status.balance.availableCents], [14928, 149.28, 0]);
  assert.ok(!JSON.stringify(status).includes('access_FAKE'));
  assert.equal(JSON.parse(store.get('mollieBalance')).pendingCents, 14928);
});
