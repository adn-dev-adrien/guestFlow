// specs/payment-link-lifecycle.md rule 63 (audit R10-M1, 2026-10-31) — a payment received on a link withdrawn by hand,
// after its withdrawal (rule 56), is settled before an installment plan is made or resized, and an existing plan never
// hides the ledger row that settles it.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHarness, call, TODAY } = require('./directInstallmentsFixtures');
const { buildLedger } = require('../utils/reservationLedger');
const { settleWithdrawnPayment } = require('../utils/withdrawnPayments');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const MESSAGE = 'Paiement reçu sur un lien retiré : à traiter avant toute nouvelle demande.';
const PAID_AT = '2026-10-26T09:15:00Z';

// The rule-8 state: withdrawn by hand (`cancelled` / `operator`), then paid at the provider.
function addUnsettledLink(h, { type = 'deposit', amountCents = 30000, installmentId = null } = {}) {
  const row = h.paymentLinksModel.create({
    reservationId: h.reservationId, type, amountCents, provider: 'qonto', providerLinkId: `pl_${type}_${amountCents}`,
    url: 'https://pay.example.test/x', status: 'open', installmentId,
  });
  h.db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'operator', paidAt = ?, providerPaymentId = ? WHERE id = ?")
    .run(PAID_AT, `pay_${row.id}`, row.id);
  return h.paymentLinksModel.findById(row.id);
}

const put = (h, body) => call(h.controller.put, { params: { id: h.reservationId }, body });

test('rule 63: no plan is made while a payment waits to be settled — 409, the card says why', async () => {
  const h = createHarness();
  addUnsettledLink(h);
  const r = await put(h, { count: 3 });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: 'UNSETTLED_WITHDRAWN_PAYMENT', message: MESSAGE });
  assert.equal(h.installmentsModel.listFor(h.reservationId).length, 0);
  const card = h.controller.planFor(h.reservationId);
  assert.equal(card.eligible, true);
  assert.equal(card.canCreate, false);
  assert.equal(card.reason, MESSAGE);
});

test('rule 63: a plan already made is not resized while a payment waits to be settled', async () => {
  const h = createHarness();
  assert.equal((await put(h, { count: 3 })).status, 200);
  addUnsettledLink(h, { type: 'balance' });
  const r = await put(h, { count: 2 });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'UNSETTLED_WITHDRAWN_PAYMENT');
  assert.equal(h.installmentsModel.listFor(h.reservationId).length, 3);
});

test('rule 63: once settled (« Marquer remboursé »), the plan is made', async () => {
  const h = createHarness();
  const link = addUnsettledLink(h);
  await settleWithdrawnPayment(link.id, { database: h.db, paymentLinksModel: h.paymentLinksModel, outcome: 'refunded', bookPaid: async () => {} });
  const r = await put(h, { count: 3 });
  assert.equal(r.status, 200);
  assert.equal(h.installmentsModel.listFor(h.reservationId).length, 3);
  assert.equal(h.controller.planFor(h.reservationId).reason, null);
});

// ── The ledger: a plan replaces the acompte and solde rows, never the way to settle their payment ──────────
const plan = {
  installments: [
    { number: 1, amount: 500, status: 'toRequest', dueDate: addDaysToIsoDate(TODAY, 9), statusLabel: 'À demander' },
    { number: 2, amount: 501.5, status: 'upcoming', dueDate: addDaysToIsoDate(TODAY, 200), statusLabel: 'À venir' },
  ],
  gap: 0,
};
const ledgerOf = (h, installmentPlan, extra = {}) => buildLedger({
  row: h.db.prepare('SELECT * FROM reservations WHERE id = ?').get(h.reservationId),
  links: h.paymentLinksModel.listForStay(h.reservationId), installmentPlan, canRequest: true, today: TODAY, ...extra,
});
const settleIds = (rows) => rows.flatMap((r) => [r.detail?.link, ...(r.detail?.otherLinks || [])])
  .filter((l) => l && l.settle).map((l) => l.settle.linkId);

test('rule 63: with a plan, the unsettled acompte / solde / séjour payments get a row of their own with both settle actions', () => {
  const h = createHarness();
  const deposit = addUnsettledLink(h, { type: 'deposit', amountCents: 30000 });
  const full = addUnsettledLink(h, { type: 'full', amountCents: 100150 });
  const { rows } = ledgerOf(h, plan);
  assert.deepEqual(rows.map((r) => r.key).slice(0, 3), ['installment-1', 'installment-2', 'withdrawnPayments']);
  const row = rows.find((r) => r.key === 'withdrawnPayments');
  assert.equal(row.label, 'Paiements après retrait');
  assert.equal(row.amount, 1301.5);
  assert.equal(row.state, 'due');
  assert.equal(row.tone, 'warning');
  assert.equal(row.stateLabel, 'À traiter');
  assert.equal(row.action, null);
  assert.equal(row.amountEdit.mode, 'none');
  assert.equal(row.detail.link.settle.linkId, full.id);
  assert.deepEqual(Object.keys(row.detail.link.settle), ['linkId', 'stay', 'refunded']);
  assert.match(row.detail.link.label, /^1 001,50 € payés le \d{2}\/\d{2}(\/\d{4})? après retrait : à traiter$/);
  assert.deepEqual(row.detail.otherLinks.map((l) => l.settle.linkId), [deposit.id]);
  assert.deepEqual(settleIds(rows), [full.id, deposit.id]);
});

test('rule 63: one payment reads in the singular; an unsettled échéance link of the plan is shown there too', () => {
  const h = createHarness();
  const link = addUnsettledLink(h, { type: 'installment', amountCents: 50000 });
  const row = ledgerOf(h, plan).rows.find((r) => r.key === 'withdrawnPayments');
  assert.equal(row.label, 'Paiement après retrait');
  assert.equal(row.amount, 500);
  assert.equal(row.detail.link.settle.linkId, link.id);
  assert.equal(row.detail.otherLinks, undefined);
});

test('rule 63: a read-only stay offers « Marquer remboursé » only on that row', () => {
  const h = createHarness();
  addUnsettledLink(h);
  const row = ledgerOf(h, plan, { stayReadOnly: true }).rows.find((r) => r.key === 'withdrawnPayments');
  assert.deepEqual(Object.keys(row.detail.link.settle), ['linkId', 'refunded']);
});

test('rule 63: without a plan the acompte row keeps the payment — no row of its own, never twice', () => {
  const h = createHarness({ stay: { depositAmount: 300, balanceAmount: 701.5 } });
  const link = addUnsettledLink(h);
  const { rows } = ledgerOf(h, null);
  assert.equal(rows.some((r) => r.key === 'withdrawnPayments'), false);
  assert.deepEqual(settleIds(rows), [link.id]);
});

test('rule 63: once settled, the row is gone', async () => {
  const h = createHarness();
  const link = addUnsettledLink(h);
  await settleWithdrawnPayment(link.id, { database: h.db, paymentLinksModel: h.paymentLinksModel, outcome: 'refunded', bookPaid: async () => {} });
  assert.equal(ledgerOf(h, plan).rows.some((r) => r.key === 'withdrawnPayments'), false);
});
