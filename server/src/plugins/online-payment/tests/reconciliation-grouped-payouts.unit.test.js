// specs/reconciliation-assisted-matching.md rules 17–19 — grouped platform payouts that include stays whose
// payout the fiche does not carry yet: estimates, one payout run, confidence, typed shares, shown as one.
// Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, USER, addReservation, credit, build, reset, row } = require('./reconciliationFixture');

test.beforeEach(() => { reset(); });

const at = (day) => `${day}T09:00:00.000Z`;
// Booking's commission in the fixture is 16.44 %: an estimated payout is gross × 0.8356.
const est = (gross) => Math.round(gross * 100 * (1 - 0.1644));
const unrecorded = (gross, due, over = {}) => addReservation({
  platform: 'Booking', platformGrossAmount: gross, finalPrice: gross, balanceAmount: gross, depositAmount: 0, balanceDueDate: due, ...over,
});
const recorded = (payout, due, over = {}) => addReservation({
  platform: 'Booking', platformGrossAmount: payout + 60, platformPayoutAmount: payout, finalPrice: payout + 60, balanceAmount: payout + 60, depositAmount: 0, balanceDueDate: due, ...over,
});
const payout = (id, cents, settled = '2026-10-15') => credit(id, cents, { settledAt: at(settled), counterpartyName: 'BOOKING.COM B.V.', reference: 'NO.Z/ID.9' });
const itemOf = (controller, id) => controller.list({ view: 'todo' }).body.items.find((i) => i.reservation.id === id && i.proposal);

test('rule 17 — three stays whose payout is not recorded are combined at gross minus commission', () => {
  const a = unrecorded(500, '2026-10-08');
  const b = unrecorded(300, '2026-10-09');
  const c = unrecorded(200, '2026-10-10');
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', est(500) + est(300) + est(200))], { bankAccountId: 'acc-1' });
  const item = itemOf(controller, a);
  assert.equal(item.proposal.source, 'platform-group');
  assert.deepEqual(item.proposal.allocations.map((x) => x.reservationId).sort(), [a, b, c].sort());
});

test('rules 17–18 — two or more estimated rows: « à vérifier », shares to type, estimates prefilled', () => {
  const a = unrecorded(500, '2026-10-08');
  unrecorded(300, '2026-10-09');
  unrecorded(200, '2026-10-10');
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', est(500) + est(300) + est(200))], { bankAccountId: 'acc-1' });
  const { proposal } = itemOf(controller, a);
  assert.equal(proposal.confidence, 'verifier');
  assert.equal(proposal.needsShares, true);
  assert.equal(proposal.reason, 'Versement groupé de 3 séjours · montants estimés');
  assert.equal(proposal.allocations.find((x) => x.reservationId === a).amountCents, est(500));
  const bulk = controller.list({ view: 'todo', filter: 'proposed' }).body.bulk;
  assert.equal(bulk.count + bulk.toVerify.count, 0, 'a proposal that needs typed shares is never in « Tout confirmer »');
});

test('rule 18 — one estimated row among exact ones: « à vérifier » (never « probable »), its share is the credit minus the exact rows', () => {
  const exactA = recorded(400, '2026-10-08');
  const exactB = recorded(300, '2026-10-09');
  const guess = unrecorded(500, '2026-10-10');
  const credited = 40000 + 30000 + est(500) + 150;
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', credited)], { bankAccountId: 'acc-1' });
  const { proposal } = itemOf(controller, guess);
  assert.equal(proposal.confidence, 'verifier');
  assert.equal(proposal.needsShares, false);
  assert.equal(proposal.allocations.find((x) => x.reservationId === guess).amountCents, credited - 70000);
  assert.equal(proposal.allocations.find((x) => x.reservationId === exactA).amountCents, 40000);
  assert.ok(exactB);
});

test('rule 17 — one payout run: rows more than 14 days apart are never combined', () => {
  unrecorded(500, '2026-09-26');
  const late = unrecorded(300, '2026-10-12');
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', est(500) + est(300), '2026-10-14')], { bankAccountId: 'acc-1' });
  assert.equal(itemOf(controller, late), undefined, 'not proposed anywhere');
  const body = controller.list({ view: 'todo', filter: 'unmatched' }).body;
  assert.deepEqual(body.credits.map((c) => c.transactionId), ['p']);
});

test('rule 17 — the estimate tolerates 1 % per estimated row, not more', () => {
  const a = unrecorded(500, '2026-10-08');
  unrecorded(300, '2026-10-09');
  const { controller, transactions } = build();
  const sum = est(500) + est(300);
  transactions.upsertMany([payout('ok', sum + Math.round(est(500) * 0.009))], { bankAccountId: 'acc-1' });
  assert.ok(itemOf(controller, a), 'within 1 % of one row');
  reset();
  const b = unrecorded(500, '2026-10-08');
  unrecorded(300, '2026-10-09');
  const built = build();
  built.transactions.upsertMany([payout('off', sum + Math.round(sum * 0.03))], { bankAccountId: 'acc-1' });
  assert.equal(itemOf(built.controller, b), undefined, '3 % off is no estimate');
});

test('rule 17 — a row whose expected date is more than 30 days before the credit is out of the window', () => {
  const a = unrecorded(500, '2026-08-01');
  unrecorded(300, '2026-08-02');
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', est(500) + est(300), '2026-10-15')], { bankAccountId: 'acc-1' });
  assert.equal(itemOf(controller, a), undefined);
});

test('rule 18 — shares that do not make the credit to the cent are refused (SHARES_DO_NOT_SUM); exact shares become each fiche\'s payout', () => {
  const a = unrecorded(500, '2026-10-08');
  const b = unrecorded(300, '2026-10-09');
  const total = est(500) + est(300);
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', total)], { bankAccountId: 'acc-1' });
  const { proposal } = itemOf(controller, a);
  const pairs = (x, y) => [
    { transactionId: 'p', reservationId: a, ledgerKey: 'balance', amountCents: x },
    { transactionId: 'p', reservationId: b, ledgerKey: 'balance', amountCents: y },
  ];
  const refused = controller.linkBatch({ pairs: pairs(est(500), est(300) - 1), proposalId: proposal.id, user: USER });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.code, 'SHARES_DO_NOT_SUM');
  assert.match(refused.body.error, /Il manque 0,01 €/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_reconciliation_lines').get().n, 0);
  const preview = controller.previewAllocation({ pairs: pairs(est(500) + 1, est(300) - 1), proposalId: proposal.id });
  assert.equal(preview.body.valid, true, 'shares moved between the stays but the sum is exact');

  const ok = controller.linkBatch({ pairs: pairs(41000, total - 41000), proposalId: proposal.id, user: USER });
  assert.equal(ok.status, 201);
  assert.equal(row(a).platformPayoutAmount, 410);
  assert.equal(row(b).platformPayoutAmount, (total - 41000) / 100);
});

test('rule 18 — shares may not leave the proposal\'s stays', () => {
  const a = unrecorded(500, '2026-10-08');
  unrecorded(300, '2026-10-09');
  const stranger = unrecorded(100, '2026-10-09');
  const total = est(500) + est(300);
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', total)], { bankAccountId: 'acc-1' });
  const { proposal } = itemOf(controller, a);
  const answer = controller.linkBatch({ pairs: [
    { transactionId: 'p', reservationId: a, ledgerKey: 'balance', amountCents: total - 5000 },
    { transactionId: 'p', reservationId: stranger, ledgerKey: 'balance', amountCents: 5000 },
  ], proposalId: proposal.id, user: USER });
  assert.equal(answer.body.code, 'SHARES_DO_NOT_SUM');
});

test('rule 19 — every fiche of the group shows the others; discarding it discards the pairing of the credit', () => {
  const a = unrecorded(500, '2026-10-08');
  const b = unrecorded(300, '2026-10-09');
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', est(500) + est(300))], { bankAccountId: 'acc-1' });
  assert.deepEqual(itemOf(controller, a).proposal.alsoCovers.map((x) => x.reservationId), [b]);
  assert.deepEqual(itemOf(controller, b).proposal.alsoCovers.map((x) => x.reservationId), [a]);
  controller.discard({ transactionId: 'p', reservationId: a, ledgerKey: 'balance' });
  assert.equal(itemOf(controller, a), undefined);
  assert.equal(itemOf(controller, b), undefined, 'the other fiche of the group is not proposed alone either');
});

test('rule 19 — a confirmed group says on each fiche which others the credit covered', () => {
  const a = recorded(400, '2026-10-08');
  const b = recorded(300, '2026-10-09');
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', 70000)], { bankAccountId: 'acc-1' });
  const { proposalIds, amounts } = controller.list({ view: 'todo', filter: 'proposed' }).body.bulk;
  controller.confirmAll({ proposalIds, amounts, user: USER });
  const done = controller.list({ view: 'done' }).body.items;
  assert.deepEqual(done.find((i) => i.reservation.id === a).bank[0].alsoCovers.map((x) => x.reservationId), [b]);
});
