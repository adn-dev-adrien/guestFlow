// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rule 1 and rules 18-19, 28 — a reading path (the fiche, the dashboard
// tile, the journal of a month) never writes: the splits are made when the payment is seen paid (`reservation.paid`), by the
// read job and by the page that lists the reconciliation. Fictional data, dates relative to today.
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const reservationsController = require('../../../controllers/reservationsController');
const { createSplitsModel } = require('../reconciliation/molliePaymentSplits');
const { db, dayAt, build, reset, paidStay, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => {
  reset(); registry.reset(); registry.configure({ isActive: () => true, allows: () => true });
  db.exec('DROP TABLE IF EXISTS zz_write_log; CREATE TABLE zz_write_log (t TEXT);');
});
test.afterEach(() => {
  registry.reset();
  ['mollie_payment_splits', 'mollie_settlements', 'mollie_settlement_payments', 'bank_reconciliation_lines', 'bank_transactions'].forEach((t) => {
    ['i', 'u', 'd'].forEach((k) => db.exec(`DROP TRIGGER IF EXISTS zz_${t}_${k}`));
  });
  db.exec('DROP TABLE IF EXISTS zz_write_log');
});

const START = dayAt(-60);
function watchWrites() {
  ['mollie_payment_splits', 'mollie_settlements', 'mollie_settlement_payments', 'bank_reconciliation_lines', 'bank_transactions'].forEach((t) => {
    db.exec(`CREATE TRIGGER IF NOT EXISTS zz_${t}_i AFTER INSERT ON ${t} BEGIN INSERT INTO zz_write_log VALUES ('${t}'); END;
      CREATE TRIGGER IF NOT EXISTS zz_${t}_u AFTER UPDATE ON ${t} BEGIN INSERT INTO zz_write_log VALUES ('${t}'); END;
      CREATE TRIGGER IF NOT EXISTS zz_${t}_d AFTER DELETE ON ${t} BEGIN INSERT INTO zz_write_log VALUES ('${t}'); END;`);
  });
  db.exec('DELETE FROM zz_write_log');
}
const writes = () => db.prepare('SELECT t FROM zz_write_log').all().map((r) => r.t);

function fiche(id) {
  const res = { body: null, status() { return this; }, json(b) { this.body = b; return this; } };
  reservationsController.getById({ params: { id: String(id) }, user: { role: 'admin' } }, res);
  return res.body;
}
function wire() {
  const built = build({ startDate: START });
  createContext('online-payment', { db }).ledgerBankTranches(({ reservationId }) => built.controller.ledgerTranches(reservationId));
  return built;
}

test('rule 1 — the fiche\'s GET writes nothing: a link paid since the last sync shows provisional tranches, stored by the event or a page', () => {
  const { controller } = wire();
  const { reservationId } = paidStay({ cents: 10000, daysAgo: 5 });
  watchWrites();
  const before = fiche(reservationId).ledger;
  assert.equal(before.rows.find((r) => r.key === 'balance').bankTranches.length, 2, 'provisional, derived in memory');
  assert.deepEqual(writes(), [], 'a read is a read');

  controller.syncSplits();
  const after = fiche(reservationId).ledger;
  assert.equal(after.rows.find((r) => r.key === 'balance').bankTranches.length, 2);
  watchWrites();
  fiche(reservationId);
  controller.incomingItems({});
  controller.ledgerTranches(reservationId);
  assert.deepEqual(writes(), [], 'neither the fiche, nor the dashboard tile\'s provider, writes once the split exists');
});

test('rule 1 — the page that lists the reconciliation brings the splits up to date (the one reading path that may)', () => {
  const { controller } = wire();
  const { reservationId } = paidStay({ cents: 10000, daysAgo: 5 });
  assert.equal(createSplitsModel(db).all().length, 0);
  controller.list({ view: 'todo' });
  assert.equal(createSplitsModel(db).all().length, 1);
  assert.equal(controller.ledgerTranches(reservationId).rows.balance.length, 2);
});

test('rules 18-19 — the per-fiche read gives the same lines and the same recap as the whole pass would', () => {
  const { reservationId } = paidStay({ cents: 73240, daysAgo: 20 });
  const { controller, transactions } = wire();
  transactions.upsertMany([mollieCredit('c1', 58592, 16, { reference: 'REF T19274230.2610.01' })], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 58592 }], user: { id: 1 } });
  const found = controller.ledgerTranches(reservationId);
  const pass = controller.compute().items.filter((i) => i.mollie && i.reservation.id === reservationId);
  assert.deepEqual(found.rows.balance.map((t) => [t.key, t.state, t.amountCents, t.expectedDate]),
    pass.map((i) => [i.ledgerKey, i.state === 'reconciled' ? 'received' : (i.mollie.late ? 'late' : 'held'), i.expectedCents, i.expectedDate]));
  assert.equal(found.rows.balance[0].refs.qonto, 'c1');
});

test('rule 28 — the journal answers a month from one pass, and a confirmation in between is seen at once', () => {
  const { reservationId } = paidStay({ cents: 19680, daysAgo: 100 });
  const { controller, transactions } = build({ startDate: dayAt(-140) });
  transactions.upsertMany([mollieCredit('c1', 15744, 95, { reference: 'REF T19274230.2512.01' })], { bankAccountId: 'acc-1' });
  const window = { from: dayAt(-100), to: dayAt(-90) };
  const first = controller.journal(window);
  assert.deepEqual(first.entries.map((e) => e.kind), ['link']);
  assert.deepEqual(controller.journal(window), first, 'the same pass, the same answer');
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 15744 }], user: { id: 1 } });
  assert.deepEqual(controller.journal(window).entries.map((e) => e.kind), ['link', 'credit']);
});
