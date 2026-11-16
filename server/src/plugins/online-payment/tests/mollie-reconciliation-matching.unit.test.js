// specs/mollie-rolling-reserve-and-incoming-payments.md rules 5, 8-13 and 20 — a paid link is two expected receipts, and a
// Mollie credit is matched against them. Fictional data; the measured cases are the 157,44 / 39,36 pair (196,80 € at
// 80 / 20), the Gruat 14,00 € sale (11,20 €), and a grouped credit of three immediate shares and one release.
const test = require('node:test');
const assert = require('node:assert/strict');
const { upV3 } = require('../reconciliation/schema');
const { createSettlementsModel } = require('../reconciliation/mollieSettlements');
const { buildProposals } = require('../reconciliation/matcher');
const { db, TODAY, dayAt, build, reset, paidStay, mollieCredit, addReservation } = require('./mollieFixture');

test.beforeEach(() => { reset(); });

const START = dayAt(-140);
const settle = (reference, { id, amountCents, costsCents = 0, reserveReleasedCents = 0, payments }) => createSettlementsModel(db).store(
  { id, reference, settledAt: `${dayAt(-1)}T08:00:00Z`, amountCents, costsCents, reserveHeldCents: 0, reserveReleasedCents },
  payments.map((p) => ({ id: p.id, amountCents: p.amountCents, paidAt: null, description: '', paymentLinkId: p.link })),
);
const everyItem = (controller) => ['todo', 'waiting', 'done'].flatMap((view) => controller.list({ view }).body.items);

test('rule 8 — a paid link yields two expected receipts keyed #immediat and #retenue, each with its amount and date', () => {
  const { reservationId } = paidStay({ cents: 19680, daysAgo: 100 });
  const { controller } = build({ startDate: START });
  const items = everyItem(controller).filter((i) => i.reservation.id === reservationId);
  assert.deepEqual(items.map((i) => i.ledgerKey).sort(), ['balance#immediat', 'balance#retenue']);
  const immediate = items.find((i) => i.ledgerKey === 'balance#immediat');
  const reserve = items.find((i) => i.ledgerKey === 'balance#retenue');
  assert.equal(immediate.expectedCents, 15744);
  assert.equal(reserve.expectedCents, 3936);
  assert.equal(immediate.expectedDate, dayAt(-96), 'paid + 4 days');
  assert.equal(reserve.expectedDate, dayAt(-6), 'paid + 4 + 90 days');
  assert.equal(immediate.mollie.tranche, 'immediat');
  assert.equal(reserve.mollie.label, 'Retenue Mollie 20 %');
});

test('rule 9 — the measured pair: 157,44 then 39,36, each one tranche, « sûr »; confirming stores lines, never the fiche (rule 11)', () => {
  const { reservationId } = paidStay({ cents: 19680, daysAgo: 100 });
  const { controller, transactions, model } = build({ startDate: START });
  transactions.upsertMany([
    mollieCredit('c1', 15744, 95, { reference: 'REF T19274230.2512.01', transactionId: 'solio-6791-1-transaction-019d1b2f-0001' }),
  ], { bankAccountId: 'acc-1' });
  let first = everyItem(controller).find((i) => i.ledgerKey === 'balance#immediat');
  assert.equal(first.state, 'proposed');
  assert.equal(first.proposal.confidence, 'sur');
  const rowBefore = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
  const historyBefore = db.prepare('SELECT COUNT(*) AS n FROM reservation_history').get().n;
  const answer = controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 15744 }], user: { id: 1 } });
  assert.equal(answer.status, 201, JSON.stringify(answer.body));
  assert.deepEqual(answer.body.marked, [], 'rule 11 — no fiche is marked');
  assert.deepEqual(db.prepare('SELECT * FROM reservations WHERE id = ?').get(rowBefore.id), rowBefore);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_history').get().n, historyBefore);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_reconciliation_fiche_writes').get().n, 0);
  assert.equal(model.linesOfTransaction('c1').length, 1);

  first = everyItem(controller).find((i) => i.ledgerKey === 'balance#immediat');
  assert.equal(first.state, 'reconciled');
  const reserve = everyItem(controller).find((i) => i.ledgerKey === 'balance#retenue');
  assert.equal(reserve.expectedDate, dayAt(-5), 'the reserve counts 90 days from the immediate credit\'s real bank date');
  transactions.upsertMany([mollieCredit('c2', 3936, 5, { reference: 'REF T19274230.2603.01' })], { bankAccountId: 'acc-1' });
  const proposed = everyItem(controller).find((i) => i.ledgerKey === 'balance#retenue');
  assert.equal(proposed.proposal.confidence, 'sur');
  assert.equal(proposed.proposal.source, 'mollie');
  controller.confirm({ transactionId: 'c2', allocations: [{ reservationId, ledgerKey: 'balance#retenue', amountCents: 3936 }], user: { id: 1 } });
  assert.ok(everyItem(controller).filter((i) => i.reservation.id === reservationId).every((i) => i.state === 'reconciled'));
});

test('rule 9 — the Gruat sale: 80 % of 14,00 € is the 11,20 € credit, « sûr », and « Défaire » removes the lines (rule 11)', () => {
  const { reservationId } = paidStay({ cents: 1400, daysAgo: 8, clientId: 2 });
  const { controller, transactions, model } = build({ startDate: START });
  transactions.upsertMany([mollieCredit('g1', 1120, 4, { reference: 'REF T19274230.2611.01' })], { bankAccountId: 'acc-1' });
  const item = everyItem(controller).find((i) => i.ledgerKey === 'balance#immediat');
  assert.equal(item.proposal.confidence, 'sur');
  assert.equal(item.proposal.amountCents, 1120);
  controller.confirm({ transactionId: 'g1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 1120 }], user: { id: 1 } });
  assert.equal(model.linesOfTransaction('g1').length, 1);
  assert.equal(controller.undo({ transactionId: 'g1', user: { id: 1 } }).status, 200);
  assert.equal(model.linesOfTransaction('g1').length, 0);
});

test('rule 9 — a grouped credit is the smallest combination of tranches, « probable »; no exact combination, no proposal', () => {
  paidStay({ cents: 10000, daysAgo: 6 });
  paidStay({ cents: 20000, daysAgo: 6, clientId: 2 });
  paidStay({ cents: 30000, daysAgo: 6 });
  paidStay({ cents: 15000, daysAgo: 96, clientId: 2 });
  const { controller, transactions } = build({ startDate: START });
  const grouped = 8000 + 16000 + 24000 + 3000;
  transactions.upsertMany([mollieCredit('grp', grouped, 1), mollieCredit('odd', 12345, 1, { reference: 'REF T19274230.2611.09' })], { bankAccountId: 'acc-1' });
  const items = everyItem(controller);
  const keys = items.filter((i) => i.proposal && i.proposal.bank.transactionId === 'grp').map((i) => i.ledgerKey).sort();
  assert.deepEqual(keys, ['balance#immediat', 'balance#immediat', 'balance#immediat', 'balance#retenue']);
  const first = items.find((i) => i.proposal && i.proposal.bank.transactionId === 'grp');
  assert.equal(first.proposal.confidence, 'probable');
  assert.equal(first.proposal.allocations.length, 4);
  assert.equal(items.filter((i) => i.proposal && i.proposal.bank.transactionId === 'odd').length, 0);
  const credits = controller.list({ view: 'todo' }).body.credits;
  assert.deepEqual(credits.map((cr) => cr.transactionId), ['odd'], 'nothing exact: the credit stays « non rattaché »');
});

test('rule 10 — with the settlement read from Mollie, a grouped credit of 3 payments and 1 release is « sûr »', () => {
  const a = paidStay({ cents: 10000, daysAgo: 6, providerPaymentId: 'qa' });
  const b = paidStay({ cents: 20000, daysAgo: 6, clientId: 2, providerPaymentId: 'qb' });
  const c = paidStay({ cents: 30000, daysAgo: 6, providerPaymentId: 'qc' });
  paidStay({ cents: 15000, daysAgo: 96, clientId: 2, providerPaymentId: 'qd' });
  const { controller, transactions } = build({ startDate: START });
  settle('T19274230.2611.05', {
    id: 'stl_1', amountCents: 51000, reserveReleasedCents: 3000,
    payments: [{ id: 'tr_a', amountCents: 10000, link: String(a.link.id) }, { id: 'tr_b', amountCents: 20000, link: String(b.link.id) }, { id: 'tr_c', amountCents: 30000, link: String(c.link.id) }],
  });
  transactions.upsertMany([mollieCredit('grp', 8000 + 16000 + 24000 + 3000, 1, { reference: 'REF T19274230.2611.05' })], { bankAccountId: 'acc-1' });
  const item = everyItem(controller).find((i) => i.proposal && i.proposal.bank.transactionId === 'grp');
  assert.equal(item.proposal.confidence, 'sur');
  assert.equal(item.proposal.allocations.length, 4);
  assert.ok(item.proposal.reason.includes('T19274230.2611.05'));
});

test('rule 10 — a payment GuestFlow does not know leaves the known part « probable », and says so', () => {
  const a = paidStay({ cents: 10000, daysAgo: 6, providerPaymentId: 'qa' });
  const { controller, transactions } = build({ startDate: START });
  settle('T19274230.2611.06', {
    id: 'stl_2', amountCents: 20000,
    payments: [{ id: 'tr_a', amountCents: 10000, link: String(a.link.id) }, { id: 'tr_x', amountCents: 10000, link: null }],
  });
  transactions.upsertMany([mollieCredit('part', 16000, 1, { reference: 'REF T19274230.2611.06' })], { bankAccountId: 'acc-1' });
  const item = everyItem(controller).find((i) => i.proposal);
  assert.equal(item.proposal.confidence, 'probable');
  assert.equal(item.proposal.amountCents, 8000);
  assert.match(item.proposal.reason, /1 paiement Mollie inconnu de GuestFlow/);
});

test('rule 5 — Mollie\'s fees are never a fiche\'s gap: a credit short by the estimated fees is proposed with them named', () => {
  const { reservationId } = paidStay({ cents: 10000, daysAgo: 6 });
  const { controller, transactions } = build({ startDate: START });
  // 1,4 % + 0,25 € of 100,00 € = 1,65 €
  transactions.upsertMany([mollieCredit('fee', 8000 - 165, 1)], { bankAccountId: 'acc-1' });
  const item = everyItem(controller).find((i) => i.ledgerKey === 'balance#immediat');
  assert.equal(item.proposal.confidence, 'sur');
  assert.match(item.proposal.reason, /frais Mollie estimés : 1,65/);
  assert.equal(item.proposal.amountCents, 7835);
  controller.confirm({ transactionId: 'fee', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 7835 }], user: { id: 1 } });
  const after = everyItem(controller).find((i) => i.ledgerKey === 'balance#immediat');
  assert.equal(after.state, 'reconciled', 'short of its fees at most: no « écart de montant »');
  const over = mollieCredit('big', 8100, 1);
  transactions.upsertMany([over], { bankAccountId: 'acc-1' });
  assert.equal(everyItem(controller).filter((i) => i.proposal && i.proposal.bank.transactionId === 'big').length, 0, 'a credit above its tranche is no match');
});

test('rule 9 — a Mollie credit is recognised by its counterparty, whatever the operation type, and only a payment from then on', () => {
  paidStay({ cents: 10000, daysAgo: 6 });
  const { controller, transactions } = build({ startDate: START });
  transactions.upsertMany([
    mollieCredit('early', 8000, 20, { operationType: 'income' }),
    mollieCredit('typed', 8000, 1, { operationType: 'card_acquirer_payout' }),
  ], { bankAccountId: 'acc-1' });
  const proposals = everyItem(controller).filter((i) => i.proposal);
  assert.deepEqual([...new Set(proposals.map((i) => i.proposal.bank.transactionId))], ['typed'], 'a credit older than the payment is nothing of it');
});

test('rule 9 — two links of the same amount: the earliest is proposed, « probable », never auto-confirmed', () => {
  paidStay({ cents: 10000, daysAgo: 7 });
  paidStay({ cents: 10000, daysAgo: 5, clientId: 2 });
  const { controller, transactions } = build({ startDate: START });
  transactions.upsertMany([mollieCredit('twin', 8000, 1)], { bankAccountId: 'acc-1' });
  const proposed = everyItem(controller).filter((i) => i.proposal);
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0].proposal.confidence, 'probable');
});

test('rule 8 — the bare ledger key of a link is rewritten to #immediat by the migration, once, nothing lost', () => {
  const { reservationId } = paidStay({ cents: 19680, daysAgo: 30 });
  db.prepare("INSERT INTO bank_reconciliation_lines (transactionId, reservationId, ledgerKey, amountCents, createdAt) VALUES ('old', ?, 'balance', 15744, ?)").run(reservationId, TODAY);
  db.prepare("INSERT INTO bank_reconciliation_lines (transactionId, reservationId, ledgerKey, amountCents, createdAt) VALUES ('other', ?, 'deposit', 100, ?)").run(reservationId, TODAY);
  const keys = () => db.prepare('SELECT ledgerKey FROM bank_reconciliation_lines ORDER BY id').all().map((r) => r.ledgerKey);
  upV3(db);
  assert.deepEqual(keys(), ['balance#immediat', 'deposit'], 'only the key of a paid link moves');
  upV3(db);
  assert.deepEqual(keys(), ['balance#immediat', 'deposit'], 'idempotent');
});

test('rule 12 — a reconciled tranche shows the identifiers of its credit: Qonto transaction, Mollie settlement, Mollie payment', () => {
  const { reservationId, link } = paidStay({ cents: 19680, daysAgo: 100 });
  const { controller, transactions } = build({ startDate: START });
  transactions.upsertMany([mollieCredit('c1', 15744, 95, { reference: 'REF T19274230.2512.01', transactionId: 'solio-6791-1-transaction-019d1b2f-aaaa' })], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 15744 }], user: { id: 1 } });
  db.prepare('UPDATE payment_link_splits SET molliePaymentId = ? WHERE paymentLinkId = ?').run('tr_WDqYK6vllg', String(link.id));
  const item = everyItem(controller).find((i) => i.ledgerKey === 'balance#immediat');
  assert.deepEqual(item.bank[0].refs, { qonto: 'solio-6791-1-transaction-019d1b2f-aaaa', mollieSettlement: 'T19274230.2512.01', molliePayment: 'tr_WDqYK6vllg' });
});

test('rule 12 — the Qonto transaction id is stored when the credit is read', () => {
  const { transactions } = build({ startDate: START });
  transactions.upsertMany([mollieCredit('c9', 100, 3, { transactionId: 'solio-6791-1-transaction-019d1b2f-bbbb' })], { bankAccountId: 'acc-1' });
  assert.equal(transactions.get('c9').qontoReference, 'solio-6791-1-transaction-019d1b2f-bbbb');
  transactions.upsertMany([mollieCredit('c9', 100, 3)], { bankAccountId: 'acc-1' });
  assert.equal(transactions.get('c9').qontoReference, 'solio-6791-1-transaction-019d1b2f-bbbb', 'a read that omits it keeps it');
});

test('rule 13 — a reserve past its window without a credit is late, and raises one item per fiche on the home page', () => {
  const { reservationId } = paidStay({ cents: 19680, daysAgo: 110 });
  const second = paidStay({ cents: 10000, daysAgo: 112, clientId: 2 });
  const { controller } = build({ startDate: START });
  const reserve = everyItem(controller).find((i) => i.reservation.id === reservationId && i.ledgerKey === 'balance#retenue');
  assert.equal(reserve.state, 'late');
  const attention = controller.reserveAttention();
  assert.equal(attention.count, 2);
  assert.equal(attention.items[0].reservationId, second.reservationId, 'the oldest expected first');
  assert.equal(attention.items[0].expectedDate, dayAt(-18));
  const { summarizeReserve } = require('../reconciliation/attention');
  const summary = summarizeReserve(attention);
  assert.equal(summary.title, 'Retenue Mollie non reçue');
  assert.equal(summary.count, 2);
  const gaps = controller.attention();
  assert.ok(gaps.items.every((i) => !i.key.endsWith('#retenue')), 'not counted twice');
});

test('rule 13 — one item per fiche, whatever the number of its late reserves', () => {
  const first = paidStay({ cents: 10000, daysAgo: 110 });
  addReservation({ id: 9001, startDate: dayAt(-120), endDate: dayAt(-118), balanceAmount: 0, finalPrice: 0 });
  const { controller } = build({ startDate: START });
  assert.equal(controller.reserveAttention().count, 1);
  assert.equal(controller.reserveAttention().items[0].reservationId, first.reservationId);
});

test('rule 20 — the fiche\'s reconciliation card lists the two tranches as two receipts', () => {
  const { reservationId } = paidStay({ cents: 19680, daysAgo: 30 });
  const { controller } = build({ startDate: START });
  const block = controller.buildFicheBlock({ id: reservationId });
  assert.deepEqual(block.lines.map((l) => l.ledgerKey).sort(), ['balance#immediat', 'balance#retenue']);
  assert.ok(block.lines.every((l) => l.mollie && l.bank.length === 0));
});

test('rule 9 — the matcher alone: a Mollie credit never proposes a platform payout or a guest transfer', () => {
  const receipt = { key: '1|balance#immediat', reservationId: 1, ledgerKey: 'balance#immediat', channel: 'mollie', openCents: 8000, expectedCents: 8000,
    linkPaidAt: dayAt(-10), expectedDate: dayAt(-6), mollie: { tranche: 'immediat', paymentLinkId: '1', lateAfterDays: 8 }, reservation: { id: 1, lastName: 'Dupont', reservationNumber: '' } };
  const credit = { id: 't1', amountCents: 8000, remainingCents: 8000, currency: 'EUR', settledAt: `${dayAt(-5)}T08:00:00Z`, counterpartyName: 'Stichting Mollie Payments', label: '', reference: '', note: '' };
  const { byTransaction } = buildProposals({ transactions: [credit], receipts: [receipt], settings: {} });
  assert.equal(byTransaction.t1.kind, 'mollie');
  assert.equal(byTransaction.t1.proposal.source, 'mollie');
});
