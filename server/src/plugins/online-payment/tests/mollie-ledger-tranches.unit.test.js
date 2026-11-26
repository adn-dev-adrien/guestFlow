// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rules 18-19 — on the fiche, a paid link shows its tranches the way
// an instalment plan shows its instalments, and the money summary reads the same split as a schedule. Both are built by
// the server (the plugin contributes them through `ctx.ledgerBankTranches`); the client only draws them.
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const reservationsController = require('../../../controllers/reservationsController');
const { db, dayAt, build, reset, paidStay, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => { reset(); registry.reset(); registry.configure({ isActive: () => true, allows: () => true }); });
test.afterEach(() => { registry.reset(); });

const frShort = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const frLong = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function fiche(id) {
  const res = { body: null, status() { return this; }, json(b) { this.body = b; return this; } };
  reservationsController.getById({ params: { id: String(id) }, user: { role: 'admin' } }, res);
  return res.body;
}

// The plugin's own provider, wired to a real controller on the test database.
function wire(options) {
  const built = build({ startDate: dayAt(-60), ...options });
  createContext('online-payment', { db }).ledgerBankTranches(({ reservationId }) => built.controller.ledgerTranches(reservationId));
  return built;
}

test('rule 18 — a paid link shows two dated lines under its échéance: the immediate share received, the reserve held', () => {
  const { reservationId } = paidStay({ cents: 73240, daysAgo: 5 });
  const { transactions, controller } = wire();
  transactions.upsertMany([mollieCredit('c1', 58592, 3, { reference: 'REF T19274230.2610.01', transactionId: 'solio-6791-1-transaction-019d-0001' })], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 58592 }], user: { id: 1 } });
  const ledger = fiche(reservationId).ledger;
  const balance = ledger.rows.find((r) => r.key === 'balance');
  assert.equal(balance.bankTranches.length, 2);
  const [immediate, reserve] = balance.bankTranches;
  assert.equal(immediate.text, `Versement immédiat · 585,92 € · reçu le ${frShort(dayAt(-3))}`);
  assert.equal(immediate.state, 'received');
  assert.equal(immediate.stateLabel, `reçu le ${frShort(dayAt(-3))}`);
  assert.equal(immediate.tone, 'success');
  assert.deepEqual(immediate.refs, { qonto: 'solio-6791-1-transaction-019d-0001', mollieSettlement: 'T19274230.2610.01', molliePayment: null });
  assert.equal(reserve.text, `Retenue Mollie 20 % · 146,48 € · prévue vers le ${frLong(dayAt(-3 + 90))}`);
  assert.equal(reserve.state, 'held');
  assert.equal(reserve.stateLabel, `retenue jusqu'au ${frLong(dayAt(-3 + 90))}`);
  assert.equal(reserve.refs, null);
  assert.deepEqual([immediate.amountCents, reserve.amountCents], [58592, 14648]);
  assert.equal(ledger.rows.filter((r) => r.key === 'balance').length, 1, 'rule 7 — still one échéance');
});

test('rule 18 — the states: en transit while the immediate share is on its way, en retard once its window has passed', () => {
  const recent = paidStay({ cents: 10000, daysAgo: 1 });
  const old = paidStay({ cents: 10000, daysAgo: 30, clientId: 2 });
  wire();
  const transit = fiche(recent.reservationId).ledger.rows.find((r) => r.key === 'balance').bankTranches[0];
  assert.equal(transit.state, 'transit');
  assert.equal(transit.stateLabel, 'en transit');
  assert.equal(transit.text, `Versement immédiat · 80,00 € · attendu vers le ${frShort(dayAt(-1 + 4))}`);
  const late = fiche(old.reservationId).ledger.rows.find((r) => r.key === 'balance').bankTranches[0];
  assert.equal(late.state, 'late');
  assert.match(late.stateLabel, /^en retard de \d+ j$/);
  assert.equal(late.tone, 'error');
});

test('rule 19 — the money summary reads the split: « Payé par carte 732,40 € — 585,92 € reçus · 146,48 € retenus jusqu\'au … »', () => {
  const { reservationId } = paidStay({ cents: 73240, daysAgo: 5 });
  const { transactions, controller } = wire();
  transactions.upsertMany([mollieCredit('c1', 58592, 3)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 58592 }], user: { id: 1 } });
  const { schedule } = fiche(reservationId).ledger;
  assert.equal(schedule.text, `Payé par carte 732,40 € — 585,92 € reçus · 146,48 € retenus jusqu'au ${frLong(dayAt(-3 + 90))}`);
  assert.deepEqual(schedule.segments.map((s) => s.tone), ['default', 'success', 'muted']);
  assert.deepEqual([schedule.totalCents, schedule.receivedCents, schedule.expectedCents, schedule.lateCents], [73240, 58592, 14648, 0]);
  assert.equal(schedule.nextDate, dayAt(-3 + 90));
});

test('rule 19 — a late tranche reads « en retard » in the summary; a fiche with nothing pending shows nothing new', () => {
  const late = paidStay({ cents: 10000, daysAgo: 30 });
  const { controller } = wire();
  assert.match(fiche(late.reservationId).ledger.schedule.text, /80,00 € en retard · 20,00 € retenus jusqu'au /);
  assert.equal(fiche(late.reservationId).ledger.schedule.lateCents, 8000);

  const done = paidStay({ cents: 10000, daysAgo: 5, clientId: 2 });
  controller.syncSplits();
  assert.ok(fiche(done.reservationId).ledger.schedule, 'seen paid: its split is stored');
  // fully refunded: both tranches are gone, there is nothing left to expect
  db.prepare('UPDATE mollie_payment_splits SET refundedCents = 10000 WHERE reservationId = ?').run(done.reservationId);
  const plain = fiche(done.reservationId).ledger;
  assert.equal(plain.schedule, undefined, 'no new key on the ledger');
  assert.ok(plain.rows.every((r) => r.bankTranches === undefined));
});

test('rules 18-19 — a plugin that is not live, or a stay without a paid link, adds nothing to the ledger', () => {
  const { reservationId } = paidStay({ cents: 10000, daysAgo: 3 });
  wire();
  registry.configure({ isActive: () => false, allows: () => true });
  assert.equal(fiche(reservationId).ledger.schedule, undefined);
  registry.configure({ isActive: () => true, allows: () => true });
  const nothing = require('./mollieFixture').addReservation({ balanceAmount: 500, finalPrice: 500 });
  assert.equal(fiche(nothing).ledger.schedule, undefined);
});

test('rules 18-19 — a provider that throws costs a log line, never the fiche', () => {
  const { reservationId } = paidStay({ cents: 10000, daysAgo: 3 });
  createContext('online-payment', { db }).ledgerBankTranches(() => { throw new Error('boom'); });
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.ok(fiche(reservationId).ledger.rows.length > 0);
  } finally {
    console.error = quiet;
  }
});
