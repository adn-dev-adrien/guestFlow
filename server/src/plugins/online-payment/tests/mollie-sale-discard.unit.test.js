// specs/mollie-rolling-reserve-and-incoming-payments.md rules 1 and 8 (sale outside a stay) — a proposal on the tranche of a sale
// can be discarded like a confirmation can: the sale has no reservation row, its receipt (reservation id 0) is what proves it exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const { db, dayAt, build, reset, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => { reset(); registry.reset(); registry.configure({ isActive: () => true, allows: () => true }); });
test.afterEach(() => { registry.reset(); });

const SALE_KEY = 'sale:resource-booking:77';
const sale = () => ({
  key: 'resource-booking:77', date: dayAt(-11), totalCents: 1400, booksCents: 1400, cardCents: 1400, label: 'Bain nordique',
  client: { firstName: 'Marc', lastName: 'Exemple' }, vatRate: 10, invoiceNumber: null,
});
const itemsOf = (controller) => ['todo', 'waiting', 'done'].flatMap((view) => controller.list({ view }).body.items);
function setup() {
  createContext('hourly-resources', { db }).standaloneSales(() => [sale()]);
  const built = build({ startDate: dayAt(-120), settings: { mollieCardOnSiteSince: dayAt(-30) } });
  built.transactions.upsertMany([mollieCredit('c1', 1120, 7, { reference: 'REF T19274230.2611.31' })], { bankAccountId: 'acc-1' });
  return built;
}

test('rule 8 — discarding the proposal of a sale outside a stay (reservation id 0) is stored and hides the proposal', () => {
  const { controller } = setup();
  const tranche = () => itemsOf(controller).find((i) => i.ledgerKey === `${SALE_KEY}#immediat`);
  assert.ok(tranche().proposal, 'the credit is proposed on the sale\'s immediate tranche');
  const answer = controller.discard({ transactionId: 'c1', reservationId: 0, ledgerKey: `${SALE_KEY}#immediat` });
  assert.equal(answer.status, 201);
  assert.deepEqual(db.prepare('SELECT reservationId, ledgerKey FROM bank_reconciliation_discards').all(), [{ reservationId: 0, ledgerKey: `${SALE_KEY}#immediat` }]);
  assert.equal(tranche().proposal, null);
  assert.equal(controller.discard({ transactionId: 'c1', reservationId: '0', ledgerKey: `${SALE_KEY}#immediat` }).status, 201, 'the digits of an id arrive as text too');
});

test('rule 8 — a sale that does not exist is still refused, and so is a negative id', () => {
  const { controller } = setup();
  assert.equal(controller.discard({ transactionId: 'c1', reservationId: 0, ledgerKey: 'sale:nothing#immediat' }).status, 404);
  assert.equal(controller.discard({ transactionId: 'c1', reservationId: -1, ledgerKey: `${SALE_KEY}#immediat` }).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_reconciliation_discards').get().n, 0, 'nothing stored for a refusal');
});
