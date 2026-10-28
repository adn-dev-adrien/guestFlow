// specs/reconciliation-assisted-matching.md — the money review of 2026-10-28: an early credit is no « sûr » match
// (rules 17, 20), a group never beats an exact single stay and always waits for the operator (rule 18), « Défaire »
// takes an auto-confirmed installment back (rule 21), a penalty is offered on a partial cover and completes it
// (rules 24, 31), the headline follows the penalty (rule 27), an unrecorded payout is capped (rules 5–6).
// Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, USER, addReservation, credit, build, reset, row } = require('./reconciliationFixture');
const { buildProposals, DEFAULT_PATTERNS } = require('../reconciliation/matcher');
const { eligible } = require('../reconciliation/autoConfirm');
const { buildController } = require('../../../controllers/platformPenaltiesController');
const { storedNetTotal } = require('../../../utils/quoteHeadline');
const sdk = require('../../sdk');

const penalties = buildController({
  database: db, penaltiesModel: require('../../../models/platformPenaltiesModel'),
  reservationsModel: require('../../../models/reservationsModel'), todayOf: () => '2026-10-23',
});

test.beforeEach(() => { reset(); db.prepare('DELETE FROM reservation_platform_penalties').run(); db.prepare('DELETE FROM reservation_installments WHERE reservationId >= 100').run(); });

const at = (day) => `${day}T09:00:00.000Z`;
const payout = (id, cents, day = '2026-10-12') => credit(id, cents, { settledAt: at(day), counterpartyName: 'BOOKING.COM B.V.', reference: 'NO.Z/ID.9' });
const settings = { patterns: DEFAULT_PATTERNS, batchPlatforms: ['Lodgify'], commissionRates: { Booking: 15 }, cardFeePercent: 2.8, acquiringFee: { percent: 1.4, fixedCents: 25 } };
const mk = (id, date, openCents, recorded, grossCents, platform = 'Booking') => ({
  reservationId: id, ledgerKey: 'balance', label: 'Versement', channel: `platform:${platform}`, openCents, expectedCents: openCents, needCents: openCents, capCents: openCents, grossCents,
  payoutRecorded: recorded, expectedDate: date, dueDate: date, paid: false, reservation: { id, lastName: `N${id}`, platform }, key: `${id}|balance`, order: id, tolerance: 0, unbounded: false, alreadyCovered: false,
});

test('rules 20, 32 — a credit 40 days before the expected date is no match for a platform paying after the stay, so never auto-confirmed', () => {
  const tx = { id: 't1', amountCents: 7706, remainingCents: 7706, currency: 'EUR', settledAt: '2026-05-18T14:08:19Z', counterpartyName: 'AIRBNB PAYMENTS LUXEMBOURG S', label: 'Airbnb', reference: 'Airbnb' };
  const receipt = mk(22208, '2026-06-28', 7706, true, 9142, 'Airbnb');
  const { byTransaction } = buildProposals({ transactions: [tx], receipts: [receipt], settings });
  assert.equal(byTransaction.t1.proposal, null);
  const data = { byTransaction, receiptsByKey: new Map([[receipt.key, receipt]]), txById: new Map([['t1', tx]]), allocatedOf: new Map() };
  assert.equal(eligible(data).length, 0);
});

test('rules 17, 32 — a platform that pays at booking time keeps its long early window', () => {
  const tx = { id: 't1', amountCents: 20000, remainingCents: 20000, currency: 'EUR', settledAt: '2026-03-01T10:00:00Z', counterpartyName: 'MANGOPAY+DOMAINESOLIO', label: '', reference: '' };
  const receipt = mk(5, '2026-08-01', 20000, true, 23000, 'Abracadaroom');
  const { byTransaction } = buildProposals({ transactions: [tx], receipts: [receipt], settings: { ...settings, patterns: { ...DEFAULT_PATTERNS, Abracadaroom: ['mangopay'] } } });
  assert.ok(byTransaction.t1.proposal);
});

test('rule 18 — a group never beats the exact single estimated stay, and any group with an estimate waits for the operator', () => {
  const tx = { id: 't1', amountCents: 30000, remainingCents: 30000, currency: 'EUR', settledAt: '2026-07-20T10:00:00Z', counterpartyName: 'Booking.com B.V.', label: '', reference: 'NO.abc/ID.1534321' };
  const Z = mk(1, '2026-07-10', 35294, false, 35294);
  const A = mk(2, '2026-07-15', 10000, true, 11765);
  const B = mk(3, '2026-07-18', 23400, false, 23400);
  const { byTransaction } = buildProposals({ transactions: [tx], receipts: [Z, A, B], settings });
  assert.equal(byTransaction.t1.proposal.source, 'platform-unrecorded');
  assert.deepEqual(byTransaction.t1.proposal.allocations.map((a) => a.reservationId), [1]);
  assert.equal(byTransaction.t1.alternatives.length, 0);
});

test('rules 21, 33 — « Défaire » takes an auto-confirmed installment back to unpaid, aggregates included', async () => {
  const id = addReservation({ finalPrice: 600, depositAmount: 0, balanceAmount: 0 });
  sdk.coreModule('installmentsModel').buildModel(db).replacePlan(id, [
    { number: 1, dueDate: '2026-10-05', amountCents: 30000 }, { number: 2, dueDate: '2026-11-01', amountCents: 30000 },
  ], 60000);
  const { controller, transactions } = build();
  transactions.upsertMany([credit('i1', 30000, { settledAt: at('2026-10-06'), counterpartyName: 'M. DUPONT', reference: `Réservation ${row(id).reservationNumber || ''}` })], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'i1', allocations: [{ reservationId: id, ledgerKey: 'installment-1', amountCents: 30000 }], user: USER });
  const model = sdk.coreModule('installmentsModel').buildModel(db);
  assert.equal(Number(model.listFor(id)[0].paid), 1);
  const answer = controller.undo({ transactionId: 'i1', user: USER });
  assert.equal(answer.body.restored.length, 1);
  assert.equal(Number(model.listFor(id)[0].paid), 0);
  assert.equal(model.listFor(id)[0].paidDate, null);
  assert.equal(Number(row(id).installmentsPaidAmount || 0), 0);
});

test('rules 21, 33 — an installment edited since is left alone by « Défaire »', () => {
  const id = addReservation({ finalPrice: 600, depositAmount: 0, balanceAmount: 0 });
  const model = sdk.coreModule('installmentsModel').buildModel(db);
  model.replacePlan(id, [{ number: 1, dueDate: '2026-10-05', amountCents: 30000 }, { number: 2, dueDate: '2026-11-01', amountCents: 30000 }], 60000);
  const { controller, transactions } = build();
  transactions.upsertMany([credit('i1', 30000, { settledAt: at('2026-10-06') })], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'i1', allocations: [{ reservationId: id, ledgerKey: 'installment-1', amountCents: 30000 }], user: USER });
  db.prepare("UPDATE reservation_installments SET paidDate = '2026-10-09' WHERE reservationId = ? AND number = 1").run(id);
  const answer = controller.undo({ transactionId: 'i1', user: USER });
  assert.equal(answer.body.untouched.length, 1);
  assert.equal(Number(model.listFor(id)[0].paid), 1);
});

const stay = (over = {}) => addReservation({
  platform: 'Booking', platformGrossAmount: 800, platformPayoutAmount: 610.02, platformCommissionAmount: 189.98,
  finalPrice: 800, balanceAmount: 800, depositAmount: 0, balanceDueDate: '2026-10-10', ...over,
});

test('rules 24, 34 — an unpaid platform fiche with a lower credit is « partial » and the penalty is offered with the gap', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', 57002)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'p', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 57002 }], user: USER });
  const item = controller.list({ view: 'waiting' }).body.items.find((i) => i.reservation.id === id) || controller.list({ view: 'todo' }).body.items.find((i) => i.reservation.id === id);
  assert.equal(item.state, 'partial');
  assert.deepEqual(item.declarePenalty, { amountCents: 4000, amount: 40 });
});

test('rules 31, 34 — declaring the penalty marks the fiche received, from the lines already stored', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', 57002)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'p', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 57002 }], user: USER });
  assert.equal(row(id).balancePaid, 0);
  penalties.declare(id, { amount: 40, reason: 'Frais de relogement', date: '2026-10-12', source: 'reconciliation' }, USER);
  controller.afterPenalty(id);
  assert.equal(row(id).balancePaid, 1);
  assert.equal(row(id).balancePaidDate, '2026-10-12');
  assert.equal(row(id).platformPayoutAmount, 610.02, 'the statement figure stays');
  controller.afterPenalty(id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_reconciliation_fiche_writes').get().n, 1, 'idempotent');
});

test('rules 27, 35 — the fiche headline « Vous percevez » follows the penalty and does not rise in case « après »', () => {
  const id = stay({ platformPayoutAmount: 570.02, platformCommissionAmount: 229.98, balancePaid: 1, balancePaidDate: '2026-10-12' });
  const before = storedNetTotal(row(id));
  penalties.declare(id, { amount: 40, reason: 'Frais de relogement', date: '2026-10-12', source: 'fiche', payoutIncludesPenalty: true }, USER);
  assert.equal(storedNetTotal(row(id)), before, 'commission 40 lower, penalty 40: the money received is the same');
  const other = stay();
  const plain = storedNetTotal(row(other));
  penalties.declare(other, { amount: 40, reason: 'Non-conformité', date: '2026-10-12', source: 'reconciliation' }, USER);
  assert.equal(Math.round((plain - storedNetTotal(row(other))) * 100), 4000);
});

test('rules 5, 6, 36 — a payout the fiche does not carry yet takes one credit at most, the surplus stays on the other', () => {
  const id = addReservation({ platform: 'Booking', platformGrossAmount: 599, finalPrice: 599, balanceAmount: 599, depositAmount: 0, balanceDueDate: '2026-10-10' });
  const { controller, transactions } = build();
  transactions.upsertMany([payout('a', 59900), credit('b', 62000, { settledAt: at('2026-10-11'), counterpartyName: 'AUTRE' })], { bankAccountId: 'acc-1' });
  const preview = controller.previewAllocation({ reservationId: id, transactionIds: ['a', 'b'] }).body;
  assert.deepEqual(preview.pairs.map((p) => [p.transactionId, p.amountCents]), [['a', 59900]]);
  assert.deepEqual(preview.leftover.map((l) => [l.transactionId, l.cents]), []);
  const refused = controller.linkBatch({ pairs: [{ transactionId: 'b', reservationId: id, ledgerKey: 'balance', amountCents: 62000 }], user: USER });
  assert.equal(refused.body.code, 'ALLOCATION_EXCEEDS_RECEIPT');
});

test('rule 36 — the single-credit link no longer rewrites a platform payout with a crafted over-allocation', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([payout('big', 99900)], { bankAccountId: 'acc-1' });
  const answer = controller.confirm({ transactionId: 'big', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 99900 }], user: USER });
  assert.equal(answer.status, 422);
  assert.equal(row(id).platformPayoutAmount, 610.02);
});

test('rule 26 — a cancelled stay is refused with 409 (PENALTY_CANCELLED), a direct one with 422', () => {
  const cancelled = stay({ kind: 'cancelled' });
  assert.equal(penalties.declare(cancelled, { amount: 5, reason: 'abcdef', source: 'reconciliation' }, USER).status, 409);
  assert.equal(penalties.declare(addReservation({ platform: 'direct' }), { amount: 5, reason: 'abcdef', source: 'reconciliation' }, USER).status, 422);
});

test('rules 12, 38 — the bulk summary carries the combined set and how many proposals no batch takes; the client adds nothing up', () => {
  const est = (gross) => Math.round(gross * 100 * (1 - 0.1644));
  const un = (gross, due) => addReservation({ platform: 'Booking', platformGrossAmount: gross, finalPrice: gross, balanceAmount: gross, depositAmount: 0, balanceDueDate: due });
  un(500, '2026-10-08'); un(300, '2026-10-09');
  const named = addReservation({ balanceAmount: 120, finalPrice: 120, balanceDueDate: '2026-10-10' });
  const other = addReservation({ clientId: 2, balanceAmount: 80, finalPrice: 80, balanceDueDate: '2026-10-11' });
  const { controller, transactions } = build();
  transactions.upsertMany([
    payout('grp', est(500) + est(300)), credit('n', 12000, { settledAt: at('2026-10-12'), counterpartyName: 'M. DUPONT' }),
    credit('o', 8000, { settledAt: at('2026-10-12'), counterpartyName: 'SOMEONE ELSE' }),
  ], { bankAccountId: 'acc-1' });
  const { bulk } = controller.list({ view: 'todo', filter: 'proposed' }).body;
  assert.equal(bulk.leftOut, 1);
  assert.deepEqual([bulk.count, bulk.toVerify.count, bulk.withToVerify.count], [1, 1, 2]);
  assert.equal(bulk.withToVerify.totalCents, bulk.totalCents + bulk.toVerify.totalCents);
  assert.ok(named && other);
});

test('rules 11, 41 — « Actualiser » keeps the page filter end to end', async () => {
  const id = addReservation({ balanceAmount: 700, finalPrice: 700, balanceDueDate: '2026-10-10' });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('g', 75000, { settledAt: at('2026-10-12') })], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'g', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 75000 }], user: USER });
  const body = (await controller.readNow({ view: 'todo', filter: 'gaps' })).body;
  assert.equal(body.filter, 'gaps');
  assert.ok(body.items.every((i) => i.isGap));
});
