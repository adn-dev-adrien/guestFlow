// specs/payment-link-lifecycle.md rule 63 (audit R10-M1, 2026-10-31; Adrien's decision of 2026-10-31 on the review of
// #911) — once a stay has an installment plan, the only payment that can arrive is an échéance, booked on that échéance.
// No plan is made or resized while an acompte / solde / séjour link is not known dead at the provider or carries a
// payment to settle; an existing plan never hides the ledger row that settles one, which then offers the refund only.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHarness, call, TODAY } = require('./directInstallmentsFixtures');
const { buildLedger } = require('../utils/reservationLedger');
const { settleWithdrawnPayment } = require('../utils/withdrawnPayments');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const { buildController } = require('../controllers/installmentsController');
const { bookWithdrawnPaid } = require('../utils/paymentPollRunner');
const devisModel = require('../models/devisModel');
const { spies, fakeProvider } = require('./paymentLinkLifecycleFixture');
const { deactivateAbandonedLinks, assertNotPaid } = require('../utils/paymentLinkDeactivation');
const { ensurePaymentLink } = require('../utils/paymentRequestService');

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

test('rule 63: with a plan, the unsettled acompte / solde / séjour payments get a row of their own — refund only, and why', () => {
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
  assert.deepEqual(Object.keys(row.detail.link.settle), ['linkId', 'refunded']);
  assert.match(row.detail.link.label, /^1\u00a0001,50\u00a0€ payés le \d{2}\/\d{2}(\/\d{4})? après retrait : à traiter$/);
  assert.deepEqual(row.detail.otherLinks.map((l) => [l.settle.linkId, Object.keys(l.settle)]), [[deposit.id, ['linkId', 'refunded']]]);
  assert.equal(row.detail.note, 'Supprimer l’échéancier pour l’enregistrer sur le séjour.');
  assert.deepEqual(settleIds(rows), [full.id, deposit.id]);
});

test('rule 63: one payment reads in the singular; an unsettled échéance link of the plan is shown there too', () => {
  const h = createHarness();
  const link = addUnsettledLink(h, { type: 'installment', amountCents: 50000 });
  const row = ledgerOf(h, plan).rows.find((r) => r.key === 'withdrawnPayments');
  assert.equal(row.label, 'Paiement après retrait');
  assert.equal(row.amount, 500);
  assert.equal(row.detail.link.settle.linkId, link.id);
  assert.deepEqual(Object.keys(row.detail.link.settle), ['linkId', 'stay', 'refunded']);
  assert.equal(row.detail.otherLinks, undefined);
  assert.equal(row.detail.note, undefined);
});

test('rule 63: a read-only stay offers « Marquer remboursé » only on that row', () => {
  const h = createHarness();
  addUnsettledLink(h);
  const row = ledgerOf(h, plan, { stayReadOnly: true }).rows.find((r) => r.key === 'withdrawnPayments');
  assert.deepEqual(Object.keys(row.detail.link.settle), ['linkId', 'refunded']);
  assert.equal(row.detail.note, undefined, 'deleting the plan would not bring « Enregistrer » back on a read-only stay');
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

test('rule 63 (review of #911, m2): with no plan, an acompte « Sans objet » and a complement behind a newer link still show their payment', () => {
  const h = createHarness({ stay: { complementAmount: 40 } });
  const deposit = addUnsettledLink(h, { type: 'deposit', amountCents: 9000 });
  const complement = addUnsettledLink(h, { type: 'complement', amountCents: 4000 });
  h.paymentLinksModel.create({ reservationId: h.reservationId, type: 'complement', amountCents: 4000, providerLinkId: 'pl_newer', url: 'u' });
  const { rows } = ledgerOf(h, null);
  assert.equal(rows.find((r) => r.key === 'deposit').state, 'na');
  assert.equal(rows.find((r) => r.key === 'complement').detail.link.status, 'open');
  const row = rows.find((r) => r.key === 'withdrawnPayments');
  assert.deepEqual([row.detail.link.settle.linkId, ...row.detail.otherLinks.map((l) => l.settle.linkId)], [complement.id, deposit.id]);
  assert.deepEqual(Object.keys(row.detail.link.settle), ['linkId', 'stay', 'refunded'], 'no plan: recorded on the stay as usual');
  assert.equal(row.detail.note, undefined);
});

// ── Plan creation and resize: only once every acompte / solde / séjour link is known dead ───────────────
const DEACTIVATION_CREATE = 'Ancien lien de paiement pas encore désactivé : échéancier non créé.';
const DEACTIVATION_RESIZE = 'Ancien lien de paiement pas encore désactivé : échéancier inchangé.';

// Withdrawn by hand while the provider could not be reached: the deactivation (and the read) are still owed.
function addOwedLink(h, { type = 'deposit', status = 'cancelled', marker = true, lastLook = false } = {}) {
  const row = h.paymentLinksModel.create({ reservationId: h.reservationId, type, amountCents: 30000, providerLinkId: `pl_owed_${type}_${status}`, url: 'u' });
  h.db.prepare(`UPDATE payment_links SET status = ?, cancelReason = ?, remoteCancelPendingAt = ?, lastLookAt = ? WHERE id = ?`)
    .run(status, status === 'expired' ? 'validity' : 'operator', marker ? '2026-10-26 09:00:00' : null, lastLook ? '2026-10-26T10:00:00.000Z' : null, row.id);
  return h.paymentLinksModel.findById(row.id);
}

const LAST_LOOK_CREATE = 'Ancien lien de paiement en dernière vérification : échéancier non créé.';
for (const [name, fields, error, message] of [
  ['withdrawn by hand, its deactivation owed', { status: 'cancelled', marker: true }, 'LINK_DEACTIVATION_PENDING', DEACTIVATION_CREATE],
  ['lapsed, its deactivation owed', { status: 'expired', marker: true }, 'LINK_DEACTIVATION_PENDING', DEACTIVATION_CREATE],
  ['lapsed, its last look owed', { status: 'expired', marker: false, lastLook: true }, 'LINK_LAST_LOOK_PENDING', LAST_LOOK_CREATE],
]) {
  test(`rule 63: a plan is refused while a link is ${name} — 409, the card says why, nothing read`, async () => {
    const h = createHarness();
    addOwedLink(h, fields);
    const r = await put(h, { count: 3 });
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { error, message });
    assert.equal(h.installmentsModel.listFor(h.reservationId).length, 0);
    assert.deepEqual(h.state.deactivated, []);
    const card = h.controller.planFor(h.reservationId);
    assert.deepEqual([card.canCreate, card.reason], [false, message]);
  });
}

test('rule 63: an open acompte link whose deactivation fails leaves no plan; once deactivated, the plan is made', async () => {
  const h = createHarness();
  const open = h.paymentLinksModel.create({ reservationId: h.reservationId, type: 'deposit', amountCents: 30000, providerLinkId: 'ql_dep', url: 'u' });
  h.state.deactivationFails = true;
  const refused = await put(h, { count: 3 });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'LINK_DEACTIVATION_PENDING');
  assert.equal(h.installmentsModel.listFor(h.reservationId).length, 0);
  const link = h.paymentLinksModel.findById(open.id);
  assert.equal(link.status, 'cancelled');
  assert.ok(link.remoteCancelPendingAt, 'withdrawn, the poll owes its deactivation');
  h.paymentLinksModel.clearRemoteCancelPending(open.id);
  h.state.deactivationFails = false;
  assert.equal((await put(h, { count: 3 })).status, 200);
});

test('rule 63: a resize is refused while an acompte link still owes its deactivation', async () => {
  const h = createHarness();
  assert.equal((await put(h, { count: 3 })).status, 200);
  addOwedLink(h);
  const r = await put(h, { count: 2 });
  assert.deepEqual([r.status, r.body.error, r.body.message], [409, 'LINK_DEACTIVATION_PENDING', DEACTIVATION_RESIZE]);
  assert.equal(h.installmentsModel.listFor(h.reservationId).length, 3);
});

// A controller on the harness's database whose provider reads are spied on (and can stand for a poll pass).
function spiedController(h, { duringRead = () => {} } = {}) {
  const seen = { read: [], deactivated: [] };
  const controller = buildController({
    database: h.db, installmentsModel: h.installmentsModel, paymentLinksModel: h.paymentLinksModel,
    quoteOf: () => h.state.quote, providerReady: () => true, todayOf: () => h.state.today,
    deactivateLinks: async (links) => { seen.deactivated.push(...links.map((l) => l.id)); links.forEach((l) => h.paymentLinksModel.clearRemoteCancelPending(l.id)); },
    assertLinkNotPaid: async (link) => { seen.read.push(link.id); duringRead(link); },
  });
  return { controller, seen, put: (body) => call(controller.put, { params: { id: h.reservationId }, body }) };
}

test('rule 63 (review of #911, m2): the refusal comes before any provider read or withdrawal', async () => {
  const h = createHarness();
  const open = h.paymentLinksModel.create({ reservationId: h.reservationId, type: 'balance', amountCents: 70000, providerLinkId: 'ql_bal', url: 'u' });
  addUnsettledLink(h);
  const s = spiedController(h);
  const r = await s.put({ count: 3 });
  assert.equal(r.body.error, 'UNSETTLED_WITHDRAWN_PAYMENT');
  assert.deepEqual(s.seen, { read: [], deactivated: [] });
  assert.equal(h.paymentLinksModel.findById(open.id).status, 'open');
});

test('rule 63 (review of #911, m1): a payment found by the poll during the provider read refuses the plan', async () => {
  const h = createHarness();
  const open = h.paymentLinksModel.create({ reservationId: h.reservationId, type: 'deposit', amountCents: 30000, providerLinkId: 'ql_dep', url: 'u' });
  const other = h.paymentLinksModel.create({ reservationId: h.reservationId, type: 'balance', amountCents: 70000, providerLinkId: 'ql_old', url: 'u' });
  h.db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'operator' WHERE id = ?").run(other.id);
  const s = spiedController(h, {
    duringRead: () => h.db.prepare('UPDATE payment_links SET paidAt = ? WHERE id = ?').run(PAID_AT, other.id),
  });
  const r = await s.put({ count: 3 });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'UNSETTLED_WITHDRAWN_PAYMENT');
  assert.deepEqual(s.seen.read, [open.id]);
  assert.equal(h.installmentsModel.listFor(h.reservationId).length, 0);
});

test('rule 63 (review of #911, m2): the dates and amounts of a plan stay editable while a payment waits', async () => {
  const h = createHarness();
  assert.equal((await put(h, { count: 3 })).status, 200);
  addUnsettledLink(h, { type: 'balance' });
  const [first] = h.installmentsModel.listFor(h.reservationId);
  const dates = await put(h, { dates: [{ id: first.id, dueDate: addDaysToIsoDate(TODAY, 20) }] });
  assert.equal(dates.status, 200);
  const amounts = await put(h, { amounts: [{ id: first.id, amount: 300 }] });
  assert.equal(amounts.status, 200);
  assert.equal(h.installmentsModel.findById(first.id).amountCents, 30000);
});

// ── Settling beside a plan (Adrien, 2026-10-31): the échéance takes its own payment, the buckets are refunded ──
const bookThrough = (h, s) => (l, pay) => bookWithdrawnPaid({ database: h.db, devisModel: devisModel.buildModel(h.db), paymentLinksModel: h.paymentLinksModel, link: l, pay, ...s });

for (const [type, amountCents] of [['deposit', 9000], ['full', 100150], ['balance', 21000]]) {
  test(`rule 63 (review of #911, M1): beside a plan, « Enregistrer sur le séjour » of a ${type} payment is refused; the refund works`, async () => {
    const h = createHarness();
    assert.equal((await put(h, { count: 2 })).status, 200);
    const link = addUnsettledLink(h, { type, amountCents });
    const s = spies();
    const deps = { database: h.db, paymentLinksModel: h.paymentLinksModel, bookPaid: bookThrough(h, s) };
    await assert.rejects(settleWithdrawnPayment(link.id, { ...deps, outcome: 'stay' }), (err) => err.httpStatus === 409
      && err.error === 'INSTALLMENT_PLAN_IN_PLACE' && err.message === 'Échéancier en place : rembourser, ou supprimer l’échéancier d’abord.');
    const row = h.db.prepare('SELECT depositPaid, balancePaid FROM reservations WHERE id = ?').get(h.reservationId);
    assert.deepEqual([row.depositPaid, row.balancePaid], [0, 0]);
    assert.deepEqual(h.installmentsModel.listFor(h.reservationId).map((i) => i.paid), [0, 0]);
    assert.equal(h.paymentLinksModel.findById(link.id).status, 'cancelled');
    assert.deepEqual(s.confirmed, []);
    const { link: after } = await settleWithdrawnPayment(link.id, { ...deps, outcome: 'refunded' });
    assert.equal(after.cancelReason, 'refunded');
  });
}

test('rule 63: an échéance paid after its withdrawal keeps « Enregistrer sur le séjour », which marks that échéance paid', async () => {
  const h = createHarness();
  assert.equal((await put(h, { count: 2 })).status, 200);
  const [, second] = h.installmentsModel.listFor(h.reservationId);
  const link = addUnsettledLink(h, { type: 'installment', amountCents: second.amountCents, installmentId: second.id });
  const s = spies();
  await settleWithdrawnPayment(link.id, { database: h.db, paymentLinksModel: h.paymentLinksModel, outcome: 'stay', bookPaid: bookThrough(h, s) });
  assert.equal(h.paymentLinksModel.findById(link.id).status, 'paid');
  assert.deepEqual(h.installmentsModel.listFor(h.reservationId).map((i) => i.paid), [0, 1]);
  const row = h.db.prepare('SELECT depositPaid, balancePaid FROM reservations WHERE id = ?').get(h.reservationId);
  assert.deepEqual([row.depositPaid, row.balancePaid], [0, 0]);
});

test('rule 63 (re-review of #911, m2): the note is not offered once an échéance is paid — the plan can no longer be deleted', () => {
  const h = createHarness();
  addUnsettledLink(h, { type: 'full', amountCents: 100150 });
  const frozen = { ...plan, installments: [{ ...plan.installments[0], status: 'paid', paidDate: TODAY }, plan.installments[1]] };
  const row = ledgerOf(h, frozen).rows.find((r) => r.key === 'withdrawnPayments');
  assert.deepEqual(Object.keys(row.detail.link.settle), ['linkId', 'refunded']);
  assert.equal(row.detail.note, undefined);
});

// ── The real deactivation path (review of #911, n2): `deactivateAbandonedLinks` and `assertNotPaid` ─────────
function realController(h, provider) {
  return buildController({
    database: h.db, installmentsModel: h.installmentsModel, paymentLinksModel: h.paymentLinksModel,
    quoteOf: () => h.state.quote, providerReady: () => Boolean(provider), todayOf: () => h.state.today,
    deactivateLinks: (links) => deactivateAbandonedLinks(links, { paymentLinksModel: h.paymentLinksModel, providerFor: () => provider }),
    assertLinkNotPaid: (link) => assertNotPaid(link, provider),
  });
}
const openBucketLinks = (h) => ['deposit', 'balance'].map((type, i) => h.paymentLinksModel.create({
  reservationId: h.reservationId, type, amountCents: [30000, 70000][i], providerLinkId: `ql_${type}`, url: 'u',
}));

test('rule 63: the provider deactivates the open acompte and solde links — the plan is made', async () => {
  const h = createHarness();
  const links = openBucketLinks(h);
  const provider = fakeProvider();
  const c = realController(h, provider);
  const r = await call(c.put, { params: { id: h.reservationId }, body: { count: 2 } });
  assert.equal(r.status, 200);
  assert.equal(h.installmentsModel.listFor(h.reservationId).length, 2);
  for (const link of links.map((l) => h.paymentLinksModel.findById(l.id))) {
    assert.deepEqual([link.status, link.cancelReason, link.remoteCancelPendingAt], ['cancelled', 'amount-changed', null]);
  }
  assert.equal(provider.calls.filter((x) => x[0] === 'cancelLink').length, 2);
});

test('rule 63: no provider connected — 409, no plan, the links withdrawn here with their deactivation owed', async () => {
  const h = createHarness();
  const links = openBucketLinks(h);
  const c = realController(h, null);
  const r = await call(c.put, { params: { id: h.reservationId }, body: { count: 2 } });
  assert.deepEqual([r.status, r.body.error, r.body.message], [409, 'LINK_DEACTIVATION_PENDING', DEACTIVATION_CREATE]);
  assert.equal(h.installmentsModel.listFor(h.reservationId).length, 0);
  for (const link of links.map((l) => h.paymentLinksModel.findById(l.id))) {
    assert.equal(link.status, 'cancelled');
    assert.ok(link.remoteCancelPendingAt, 'the poll deactivates it once a provider answers');
  }
});

// ── The stay's link lock: a plan and a stay link asked at the same moment ────────────────────────────────
function gatedProvider() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered;
  const inside = new Promise((resolve) => { entered = resolve; });
  let n = 0;
  return {
    release, inside, id: 'qonto',
    async createLink() { entered(); await gate; n += 1; return { id: `ql_race_${n}`, url: `https://pay.example.test/race/${n}`, status: 'open' }; },
    async getPayment() { return { paid: false }; },
    async getLinkStatus() { return 'open'; },
    async cancelLink() {},
    isReady: () => true,
  };
}
const openBucketLinksOf = (h) => h.paymentLinksModel.listForStay(h.reservationId)
  .filter((l) => ['deposit', 'balance', 'full'].includes(l.type) && l.status === 'open');

test('rule 63: an acompte link being minted when the plan is asked for — the plan waits, then retires it', async () => {
  const h = createHarness({ stay: { depositAmount: 300, balanceAmount: 701.5 } });
  const provider = gatedProvider();
  const mint = ensurePaymentLink({ database: h.db, paymentLinksModel: h.paymentLinksModel, provider, resolveAmountCents: () => 30000 }, h.reservationId, 'deposit');
  await provider.inside;
  const planning = put(h, { count: 3 });
  provider.release();
  const minted = await mint;
  const r = await planning;
  assert.equal(r.status, 200);
  assert.equal(h.installmentsModel.listFor(h.reservationId).length, 3);
  assert.equal(h.paymentLinksModel.findById(minted.id).status, 'cancelled');
  assert.deepEqual(openBucketLinksOf(h), []);
});

test('rule 63: an acompte link asked while the plan is being made — it waits, then finds nothing to bill', async () => {
  const h = createHarness({ stay: { depositAmount: 300, balanceAmount: 701.5 } });
  h.state.quote = { preArrivalAmount: 1001.5, depositAmount: 0, balanceAmount: 0, depositDueDate: null, balanceDueDate: null };
  h.paymentLinksModel.create({ reservationId: h.reservationId, type: 'balance', amountCents: 70150, providerLinkId: 'ql_bal', url: 'u' });
  let mint;
  const s = spiedController(h, {
    duringRead: () => {
      mint = ensurePaymentLink({
        database: h.db, paymentLinksModel: h.paymentLinksModel, provider: fakeProvider(),
        resolveAmountCents: (id) => Math.round(Number(h.db.prepare('SELECT depositAmount FROM reservations WHERE id = ?').get(id).depositAmount) * 100),
      }, h.reservationId, 'deposit');
    },
  });
  const r = await s.put({ count: 3 });
  assert.equal(r.status, 200);
  await assert.rejects(mint, (err) => err.error === 'ZERO_AMOUNT');
  assert.deepEqual(openBucketLinksOf(h), []);
});
