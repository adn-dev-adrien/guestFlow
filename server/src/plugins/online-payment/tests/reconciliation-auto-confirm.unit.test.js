// specs/reconciliation-assisted-matching.md rules 20–21 — after a read, the certain matches confirm
// themselves, visibly and undoably; nothing else does. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, USER, addReservation, credit, build, reset, row } = require('./reconciliationFixture');

test.beforeEach(() => { reset(); });

const at = (day) => `${day}T09:00:00.000Z`;
const recorded = (payout, over = {}) => addReservation({
  platform: 'Booking', platformGrossAmount: payout + 60, platformPayoutAmount: payout, platformCommissionAmount: 60, finalPrice: payout + 60,
  balanceAmount: payout + 60, depositAmount: 0, balanceDueDate: '2026-10-10', ...over,
});
const payout = (id, cents) => credit(id, cents, { settledAt: at('2026-10-12'), counterpartyName: 'BOOKING.COM B.V.', reference: 'NO.Z/ID.9' });
const lines = () => db.prepare('SELECT * FROM bank_reconciliation_lines').all();
const history = (id) => db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id).map((r) => r.changedFields).join(' ');

test('rule 20 — a « sûr » single exact match is confirmed by « Actualiser », not by a page load', async () => {
  const id = recorded(400);
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', 40000)], { bankAccountId: 'acc-1' });
  controller.list({ view: 'todo' });
  assert.equal(row(id).balancePaid, 0, 'a page load confirms nothing');
  const body = (await controller.readNow({ view: 'done' })).body;
  assert.equal(row(id).balancePaid, 1);
  assert.equal(row(id).balancePaidDate, '2026-10-12');
  assert.equal(body.autoConfirmed.count, 1);
});

test('rule 20 — the 8-hour job confirms too, and a failed read confirms nothing', async () => {
  const id = recorded(400);
  const failing = build({ read: async () => ({ ok: false, error: 'down' }) });
  failing.transactions.upsertMany([payout('p', 40000)], { bankAccountId: 'acc-1' });
  await failing.controller.runJob();
  assert.equal(row(id).balancePaid, 0);
  const working = build();
  await working.controller.runJob();
  assert.equal(row(id).balancePaid, 1);
});

test('rule 20 — only the paid flag and the date are written: payout and commission stay as typed', async () => {
  const id = recorded(400);
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', 40000)], { bankAccountId: 'acc-1' });
  await controller.readNow();
  assert.equal(row(id).platformPayoutAmount, 400);
  assert.equal(row(id).platformCommissionAmount, 60, 'a commission typed by hand is not recomputed');
});

test('rule 20 — « probable » and « à vérifier » proposals wait for the operator', async () => {
  const named = addReservation({ balanceAmount: 300, finalPrice: 300, balanceDueDate: '2026-10-10' });
  const other = addReservation({ clientId: 2, balanceAmount: 125, finalPrice: 125, balanceDueDate: '2026-10-11' });
  const { controller, transactions } = build();
  transactions.upsertMany([
    credit('a', 30000, { settledAt: at('2026-10-12'), counterpartyName: 'M. DUPONT' }),
    credit('b', 12500, { settledAt: at('2026-10-12'), counterpartyName: 'SOMEONE ELSE' }),
  ], { bankAccountId: 'acc-1' });
  await controller.readNow();
  assert.equal(row(named).balancePaid, 0);
  assert.equal(row(other).balancePaid, 0);
  assert.equal(lines().length, 0);
});

test('rule 20 — a stay that is cancelled is never auto-confirmed', async () => {
  const id = recorded(400);
  db.prepare("UPDATE reservations SET cancelledAt = '2026-10-11' WHERE id = ?").run(id);
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', 40000)], { bankAccountId: 'acc-1' });
  await controller.readNow();
  assert.equal(lines().length, 0);
});

test('rule 20 — a payout the fiche does not carry yet (no amount to compare) is never auto-confirmed', async () => {
  const id = addReservation({ platform: 'Booking', platformGrossAmount: 400, finalPrice: 400, balanceAmount: 400, depositAmount: 0, balanceDueDate: '2026-10-10' });
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', 40000)], { bankAccountId: 'acc-1' });
  await controller.readNow();
  assert.equal(row(id).balancePaid, 0);
});

test('rule 20 — the setting turns it off', async () => {
  const id = recorded(400);
  const { controller, transactions, store } = build();
  store.set('reconciliationAutoConfirm', '0');
  transactions.upsertMany([payout('p', 40000)], { bankAccountId: 'acc-1' });
  const body = (await controller.readNow()).body;
  assert.equal(row(id).balancePaid, 0);
  assert.equal(body.autoConfirmed.count, 0);
});

test('rule 21 — the line is stored with auto = 1 and no user, the history says it was automatic, the item carries the badge', async () => {
  const id = recorded(400);
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', 40000)], { bankAccountId: 'acc-1' });
  await controller.readNow();
  assert.deepEqual(lines().map((l) => [l.auto, l.createdBy]), [[1, null]]);
  assert.match(history(id), /Rapprochement bancaire automatique/);
  assert.match(history(id), /reçu le 12\/10 \(virement\)/);
  const item = controller.list({ view: 'done' }).body.items.find((i) => i.reservation.id === id);
  assert.equal(item.bank[0].auto, true);
});

test('rule 21 — « Défaire » takes the fiche back and the pair is never auto-confirmed again', async () => {
  const id = recorded(400);
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', 40000)], { bankAccountId: 'acc-1' });
  await controller.readNow();
  controller.undo({ transactionId: 'p', user: USER });
  assert.equal(row(id).balancePaid, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_reconciliation_discards').get().n, 1);
  controller.runJob();
  await controller.runJob();
  assert.equal(row(id).balancePaid, 0, 'not confirmed a second time');
  assert.equal(controller.list({ view: 'todo' }).body.items.some((i) => i.reservation.id === id && i.proposal), false);
});

test('rule 21 — a manual confirmation is not marked auto', () => {
  const id = recorded(400);
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', 40000)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'p', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 40000 }], user: USER });
  assert.deepEqual(lines().map((l) => [l.auto, l.createdBy]), [[0, 1]]);
});

test('rule 20 — the setting accepts on, off and the default, nothing else', () => {
  const { RECONCILIATION_DECLARED } = require('../settingsStore');
  const { validate } = RECONCILIATION_DECLARED.find((d) => d.key === 'reconciliationAutoConfirm');
  assert.deepEqual(['', '0', '1'].map(validate), [null, null, null]);
  assert.equal(validate('maybe'), 'Réglage invalide.');
});
