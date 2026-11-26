// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rules 9 and 10 (and 4, 5, 13) — what a Mollie credit may be matched
// to once Mollie's own account of it exists, and how loose the amount path may be. Fictional data, dates relative to today.
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, DEFAULT_PATTERNS } = require('../reconciliation/matcher');
const { createSettlementsModel } = require('../reconciliation/mollieSettlements');
const { db, dayAt, build, reset, paidStay, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => { reset(); });

const START = dayAt(-140);
const mollieOwn = (over) => ({ settledAt: null, amountCents: 0, costsCents: 0, reserveHeldCents: 0, reserveReleasedCents: 0, ...over });
const everyItem = (controller) => ['todo', 'waiting', 'done'].flatMap((view) => controller.list({ view }).body.items);

test('rule 10 — a settlement that names a payment GuestFlow does not know is never « sûr » by amount, and never confirmed alone', async () => {
  const { reservationId } = paidStay({ cents: 6250, daysAgo: 6 });
  createSettlementsModel(db).store(
    mollieOwn({ id: 'stl_u', reference: '19274230.2611.09', amountCents: 5000, source: 'balance' }),
    [{ id: 'tr_unknown', kind: 'immediate', amountCents: 5000, splitId: null }],
  );
  const { controller, transactions, model } = build({ startDate: START });
  transactions.upsertMany([mollieCredit('c1', 5000, 1, { reference: 'REF T19274230.2611.09' })], { bankAccountId: 'acc-1' });
  const immediate = everyItem(controller).find((i) => i.reservation.id === reservationId && i.ledgerKey === 'balance#immediat');
  assert.equal(immediate.state, 'proposed');
  assert.equal(immediate.proposal.confidence, 'probable', 'the 50,00 € of the unknown payment is a coincidence with the tranche, not a fact');
  assert.match(immediate.proposal.reason, /Mollie/);
  await controller.runJob();
  assert.equal(model.linesOfTransaction('c1').length, 0, 'nothing is written without the operator');
});

test('rule 10 — without a settlement read, the same amount stays « sûr » (the amounts rule of rule 9)', () => {
  const { reservationId } = paidStay({ cents: 6250, daysAgo: 6 });
  const { controller, transactions } = build({ startDate: START });
  transactions.upsertMany([mollieCredit('c1', 5000, 1)], { bankAccountId: 'acc-1' });
  const immediate = everyItem(controller).find((i) => i.reservation.id === reservationId && i.ledgerKey === 'balance#immediat');
  assert.equal(immediate.proposal.confidence, 'sur');
});

test('rule 10 — a settlement composed from the payments list that frees one of several equal reserves is « probable », not « sûr »', () => {
  const first = paidStay({ cents: 6250, daysAgo: 100 });
  paidStay({ cents: 6250, daysAgo: 100, clientId: 2 });
  createSettlementsModel(db).store(
    mollieOwn({ id: 'stl_r', reference: '19274230.2611.08', amountCents: 1250, reserveReleasedCents: 1250, source: 'payments' }), [],
  );
  const { controller, transactions } = build({ startDate: START });
  transactions.upsertMany([mollieCredit('c1', 1250, 1, { reference: 'REF T19274230.2611.08' })], { bankAccountId: 'acc-1' });
  const proposed = everyItem(controller).filter((i) => i.proposal && i.ledgerKey === 'balance#retenue');
  assert.equal(proposed.length > 0, true);
  assert.ok(proposed.every((i) => i.proposal.confidence === 'probable'));
  assert.match(proposed[0].proposal.reason, /réserve libérée à confirmer/);
  assert.ok(first.reservationId);
});

test('rule 14 — the exact composition ignores dates: a reserve released long before its window is still that reserve', () => {
  const stay = paidStay({ cents: 10000, daysAgo: 10, providerPaymentId: 'qonto-early' });
  const settlements = createSettlementsModel(db);
  const { controller, transactions } = build({ startDate: START });
  transactions.upsertMany([mollieCredit('c1', 2000, 1, { reference: 'REF T19274230.2611.07' })], { bankAccountId: 'acc-1' });
  settlements.store(mollieOwn({ id: 'stl_e', reference: '19274230.2611.07', amountCents: 2000, source: 'balance' }),
    [{ id: 'tr_early', kind: 'release', amountCents: 2000, splitId: `link:${stay.link.id}` }]);
  const reserve = everyItem(controller).find((i) => i.reservation.id === stay.reservationId && i.ledgerKey === 'balance#retenue');
  assert.equal(reserve.proposal.confidence, 'sur', 'Mollie says which payment it frees: the 80-day gap to the window does not matter');
});

test('rule 14 — by amount alone, the immediate share is not matched to a credit long past its window', () => {
  const stay = paidStay({ cents: 10000, daysAgo: 100 });
  const { controller, transactions } = build({ startDate: START });
  transactions.upsertMany([mollieCredit('c1', 8000, 0)], { bankAccountId: 'acc-1' });
  const immediate = everyItem(controller).find((i) => i.reservation.id === stay.reservationId && i.ledgerKey === 'balance#immediat');
  assert.equal(immediate.proposal, null, '92 days after the expected date, only the operator can say it is that payment');
});

test('rule 15 — a reserve is released whole: a credit a cent short of it is not proposed', () => {
  const stay = paidStay({ cents: 10000, daysAgo: 100 });
  const { controller, transactions } = build({ startDate: START });
  transactions.upsertMany([mollieCredit('c1', 1999, 0)], { bankAccountId: 'acc-1' });
  const reserve = everyItem(controller).find((i) => i.reservation.id === stay.reservationId && i.ledgerKey === 'balance#retenue');
  assert.equal(reserve.proposal, null);
});

test('rule 9 — a platform that pays through Mollie stays a platform; a plain Mollie credit is Mollie', () => {
  const settings = { patterns: DEFAULT_PATTERNS };
  const viaMollie = { operationType: 'Transférer', counterpartyName: 'Mollie Payments', label: 'Booking.com B.V. payout', reference: '' };
  assert.deepEqual(classify(viaMollie, settings), { kind: 'platform', platform: 'Booking' });
  assert.deepEqual(classify({ operationType: 'Transférer', counterpartyName: 'Stichting Mollie Payments', label: '', reference: 'REF T19274230.2611.01' }, settings), { kind: 'mollie' });
  assert.deepEqual(classify({ operationType: 'card', counterpartyName: 'Mollie', label: 'booking.com', reference: '' }, settings), { kind: 'mollie' }, 'a card operation is never a platform payout');
});
