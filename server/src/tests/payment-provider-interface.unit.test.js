// specs/plugins-phase-3a-online-payment.md rules 4–6 — the core's money path talks to one payment
// provider a plugin declares; without a ready one, every online-payment entry point refuses, and the
// screens are told to hide their buttons.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const paymentProviders = require('../utils/paymentProviders');
const paymentsController = require('../controllers/paymentsController');
const { buildController: buildDashboardController } = require('../controllers/dashboardController');
const { migratePaymentLinksToProviders } = require('../utils/paymentLinksProviderMigration');
const paymentLinksModel = require('../models/paymentLinksModel');

const provider = (over = {}) => ({
  id: 'qonto',
  label: 'Qonto',
  errorCode: 'QONTO_API_ERROR',
  isReady: () => true,
  createLink: async () => ({}),
  getPayment: async () => ({ paid: false }),
  getLinkStatus: async () => 'open',
  cancelLink: async () => {},
  ...over,
});

function live(ids) {
  registry.reset();
  registry.configure({ isActive: (id) => ids.includes(id), allows: () => true });
}

function res() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

test.afterEach(() => registry.reset());

test('rule 4 — a provider lacking a member fails the registration', () => {
  live(['online-payment']);
  const ctx = createContext('online-payment', {});
  assert.throws(() => ctx.paymentProvider(provider({ cancelLink: undefined })), /lacks "cancelLink"/);
});

test('rule 4 — at most one provider per instance', () => {
  live(['online-payment', 'other-pay']);
  createContext('online-payment', {}).paymentProvider(provider());
  assert.throws(() => createContext('other-pay', {}).paymentProvider(provider({ id: 'stripe' })), /already declared by online-payment/);
});

test('rule 4 — active() is the provider of a live plugin that reports itself ready, and nothing else', () => {
  live([]);
  let ready = true;
  createContext('online-payment', {}).paymentProvider(provider({ isReady: () => ready }));
  assert.equal(paymentProviders.active(), null, 'plugin not live');
  registry.configure({ isActive: () => true });
  assert.equal(paymentProviders.active().id, 'qonto');
  assert.deepEqual(paymentProviders.summary(), { provider: 'qonto', label: 'Qonto' });
  ready = false;
  assert.equal(paymentProviders.active(), null, 'not connected');
  assert.equal(paymentProviders.summary(), null);
  assert.equal(paymentProviders.declared().id, 'qonto', 'still there to deactivate an abandoned link');
});

test('rule 5 — without a provider the payment endpoints answer 409 NO_PAYMENT_PROVIDER', async () => {
  live([]);
  for (const handler of ['createReservationPaymentLink', 'sendPaymentRequestEmail', 'pollPaymentsNow']) {
    const r = res();
    await paymentsController[handler]({ params: { id: '1' }, body: {} }, r);
    assert.equal(r.statusCode, 409, handler);
    assert.deepEqual(r.body, { error: 'NO_PAYMENT_PROVIDER', message: 'Aucun moyen de paiement en ligne n’est connecté.' });
  }
  assert.deepEqual(await paymentsController.sendDepositRequestFor(1), { httpStatus: 409, body: paymentProviders.NO_PROVIDER });
  // The links already made stay readable: stored data, needed most when the provider is gone.
  const list = res();
  await paymentsController.listReservationPaymentLinks({ params: { id: '1' }, body: {} }, list);
  assert.notEqual(list.statusCode, 409);
});

test('rule 5 — the dashboard rows lose « Relancer » and the reminder refuses without a provider', async () => {
  const row = {
    id: 7, kind: 'reservation', platform: 'direct', email: 'a@b.fr', startDate: '2026-12-20', endDate: '2026-12-22',
    depositAmount: 0, depositPaid: 1, balanceAmount: 300, balancePaid: 0, balanceDueDate: '2026-11-01',
  };
  const build = (has) => buildDashboardController({
    reservationsModel: { listPaymentDeadlineCandidates: () => [row], getPlatform: () => 'direct' },
    hasPaymentProvider: () => has,
    sendBalanceRequest: async () => ({ httpStatus: 200, body: { sent: true } }),
    today: '2026-11-10',
  });
  const on = res();
  await build(true).paymentDeadlines({ query: {} }, on);
  assert.equal(on.body.rows[0].remindType, 'balance');
  const off = res();
  await build(false).paymentDeadlines({ query: {} }, off);
  assert.equal(off.body.rows[0].remindType, null);
  const remind = res();
  await build(false).remindPaymentDeadline({ params: { id: '7' }, body: { type: 'balance' } }, remind);
  assert.equal(remind.statusCode, 409);
  assert.equal(remind.body.error, 'NO_PAYMENT_PROVIDER');
});

test('rules 6, 20 — the upgrade renames the Qonto columns, keeps every row and finds an open link by provider id', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payment_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, type TEXT NOT NULL,
    qontoPaymentLinkId TEXT, url TEXT NOT NULL DEFAULT '', amountCents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR', status TEXT NOT NULL DEFAULT 'open', qontoPaymentId TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')), paidAt TEXT, expiresAt TEXT, lastPolledAt TEXT)`);
  db.prepare("INSERT INTO payment_links (reservationId, type, qontoPaymentLinkId, url, amountCents) VALUES (5, 'deposit', 'ql_open', 'https://pay/1', 9000)").run();
  db.prepare("INSERT INTO payment_links (reservationId, type, qontoPaymentLinkId, qontoPaymentId, status, amountCents) VALUES (6, 'full', 'ql_paid', 'pay_9', 'paid', 30000)").run();

  migratePaymentLinksToProviders(db);
  migratePaymentLinksToProviders(db);

  const links = paymentLinksModel.buildModel(db);
  const open = links.findByProviderLinkId('qonto', 'ql_open');
  assert.equal(open.reservationId, 5);
  assert.equal(open.status, 'open');
  assert.equal(open.provider, 'qonto');
  assert.equal(open.remoteCancelPendingAt, null);
  assert.equal(links.findByProviderLinkId('qonto', 'ql_paid').providerPaymentId, 'pay_9');
  assert.equal(links.findByProviderLinkId('stripe', 'ql_open'), undefined);
});
