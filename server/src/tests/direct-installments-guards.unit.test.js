// specs/direct-installments.md rules 17, 34-35, 39-43 — the guards around the money: a link paid at an old amount,
// the links a plan creation / removal / platform switch abandons, concurrency, the VAT basket, hand-queued
// requests, the money templates' hard « never auto », and the boot migration on awkward rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const Database = require('better-sqlite3');

const { ensureInstallmentLink, sendInstallmentRequest } = require('../utils/paymentRequestService');
const { processPaidLink, retryPendingCancellations } = require('../utils/paymentPollRunner');
const { templateAutoSends } = require('../utils/autoSendPolicy');
const { PAYMENT_STABLE_KEYS } = require('../utils/defaultEmailTemplatesRegistry');
const { ensureDefaultEmailTemplates } = require('../utils/defaultEmailTemplatesSeed');
const { createInstallmentRequests } = require('../utils/installmentRequests');
const { buildController: buildEmailsController } = require('../controllers/emailsController');
const { buildController: buildTemplatesController } = require('../controllers/emailTemplatesController');
const { buildModel: buildLogModel } = require('../models/emailLogModel');
const { buildModel: buildQueueModel } = require('../models/emailManualQueueModel');
const { buildModel: buildTemplatesModel } = require('../models/emailTemplatesModel');
const { migrateInstallmentsSchema } = require('../utils/installmentsMigration');
const { createHarness, call, TODAY } = require('./directInstallmentsFixtures');

function fakeProvider() {
  const calls = { created: [], cancelled: [] };
  let n = 0;
  return {
    calls, id: 'qonto',
    async createLink(args) { n += 1; calls.created.push(args); return { id: `ql_${n}`, url: `https://pay.example/${n}`, status: 'open' }; },
    async getPayment() { return { paid: false }; },
    async getLinkStatus() { return 'open'; },
    async cancelLink(id) { calls.cancelled.push(id); },
  };
}

async function withPlan(options) {
  const h = createHarness(options);
  h.state.quote = { preArrivalAmount: 1001.5, depositAmount: 0, balanceAmount: 0, depositDueDate: null, balanceDueDate: null };
  await call(h.controller.put, { params: { id: h.reservationId }, body: { count: 3 } });
  const provider = fakeProvider();
  const deps = {
    database: h.db, paymentLinksModel: h.paymentLinksModel, installmentsModel: h.installmentsModel, provider,
    deactivateLinks: async (links) => h.state.deactivated.push(...links),
  };
  return { ...h, provider, deps, rows: h.installmentsModel.listFor(h.reservationId) };
}

const put = (h, body) => call(h.controller.put, { params: { id: h.reservationId }, body });

// ── Rule 17 — a link paid at an amount the plan has since moved ─────────────────────────────────────
test('rule 17 — an open link paid after a rebalance books what was received, not the new amount', async () => {
  const h = await withPlan();
  const link = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[1].id);
  h.installmentsModel.updateRow(h.rows[1].id, { amountCents: 40000 });
  const result = await processPaidLink({
    database: h.db, devisModel: {}, paymentLinksModel: h.paymentLinksModel, link: h.paymentLinksModel.findById(link.id),
    paidPayment: { paid: true, paymentId: 'pay_1', paidAt: '2026-10-28T09:00:00Z' },
  });
  assert.equal(result.effect, 'installment-marked');
  const installment = h.installmentsModel.findById(h.rows[1].id);
  assert.deepEqual([installment.paid, installment.amountCents, installment.amountEdited], [1, 33400, 1]);
});

function withMocks(modules, fn) {
  const original = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return original.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = original; }
}

test('rule 17 — a save by anyone (plugin, SAS) retires the links of the amounts it moved: performUpdate calls the retire', () => {
  const retired = [];
  const PLACEMENT = { propertyId: 1, startDate: '2099-09-10', endDate: '2099-09-12', adults: 2, children: 0, teens: 0, babies: 0 };
  const body = { clientId: 1, platform: 'direct', options: [], propertyId: 1, startDate: '2099-09-10', endDate: '2099-09-13', adults: 2, children: 0, teens: 0, babies: 0 };
  const load = (availabilityError) => withMocks({
    './installmentsController': {
      retireChangedLinks: (id) => retired.push(id), planFor: () => null, syncAfterSave: () => {}, platformChangeRefusal: () => null,
    },
    '../utils/pricing': { calculateReservationQuote: () => ({ totalPrice: 0, finalPrice: 100, depositAmount: 0, balanceAmount: 100, optionLines: [], resourceLines: [], nightlyBreakdown: [], nights: 2, error: null }) },
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-06-04' },
    '../utils/reservationAudit': { buildAuditSnapshotFromPayload: () => ({}), computeAuditChanges: () => [] },
    '../models/reservationsModel': new Proxy({}, { get: (_, k) => {
      if (k === 'getPropertyCapacity') return () => ({ maxGuests: 99, maxBabies: 99, singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
      if (k === 'getBabyBedAvailability') return () => ({ availableBabyBeds: 99 });
      if (k === 'validateAvailability') return () => availabilityError;
      if (k === 'getReservationNumber') return () => 'R-1';
      if (k === 'getForUpdate') return () => PLACEMENT;
      if (k === 'getAuditSnapshotFromDb') return () => ({ startDate: '2099-09-10' });
      if (k === 'getPricingSnapshot') return () => ({ lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [] });
      return () => null;
    } }),
    '../models/settingsModel': { read: () => ({}) },
    '../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../database': { prepare() { return { get: () => ({}), run: () => ({ changes: 0 }), all: () => [] }; } },
  }, () => {
    delete require.cache[require.resolve('../controllers/reservationsController')];
    return require('../controllers/reservationsController');
  });
  try {
    assert.equal(load(null).performUpdate('7', { ...body }).status, 200);
    assert.deepEqual(retired, ['7'], 'saved: the stale links are retired');
    assert.equal(load({ error: 'conflict', code: 'X' }).performUpdate('8', { ...body }).status, 409);
    assert.deepEqual(retired, ['7'], 'refused: nothing was saved, nothing retired');
  } finally {
    delete require.cache[require.resolve('../controllers/reservationsController')];
  }
});

// ── Rule 35 — plan creation, removal, resize, platform switch ───────────────────────────────────────
test('rule 35 — creating a plan retires and deactivates the open acompte / solde links', async () => {
  const h = createHarness();
  const deposit = h.paymentLinksModel.create({ reservationId: h.reservationId, type: 'deposit', amountCents: 30000, providerLinkId: 'ql_dep', url: 'u1' });
  const balance = h.paymentLinksModel.create({ reservationId: h.reservationId, type: 'balance', amountCents: 70000, providerLinkId: 'ql_bal', url: 'u2' });
  const created = await call(h.controller.put, { params: { id: h.reservationId }, body: { count: 3 } });
  assert.equal(created.status, 200);
  for (const link of [deposit, balance]) assert.equal(h.paymentLinksModel.findById(link.id).status, 'cancelled');
  assert.deepEqual(h.state.deactivated.map((l) => l.id).sort(), [deposit.id, balance.id].sort());
});

test('rule 35 — an acompte link the guest has just paid refuses the plan (nothing created)', async () => {
  const h = createHarness();
  const deposit = h.paymentLinksModel.create({ reservationId: h.reservationId, type: 'deposit', amountCents: 30000, providerLinkId: 'ql_dep', url: 'u1' });
  h.state.paidLinkIds.add(deposit.id);
  const refused = await call(h.controller.put, { params: { id: h.reservationId }, body: { count: 3 } });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'LINK_ALREADY_PAID');
  assert.equal(h.installmentsModel.listFor(h.reservationId).length, 0);
  assert.equal(h.paymentLinksModel.findById(deposit.id).status, 'open');
});

test('rule 35 — removing or resizing a plan whose open link was just paid is refused, the plan stays', async () => {
  const h = await withPlan();
  const link = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[1].id);
  h.state.paidLinkIds.add(link.id);
  const resize = await put(h, { count: 4 });
  const removal = await call(h.controller.remove, { params: { id: h.reservationId } });
  assert.deepEqual([resize.status, removal.status], [409, 409]);
  assert.equal(h.installmentsModel.listFor(h.reservationId).length, 3);
  assert.equal(h.paymentLinksModel.findById(link.id).status, 'open');
});

test('rule 35 — removing a plan retires and deactivates its open links', async () => {
  const h = await withPlan();
  const link = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[1].id);
  const removal = await call(h.controller.remove, { params: { id: h.reservationId } });
  assert.equal(removal.status, 200);
  assert.equal(h.paymentLinksModel.findById(link.id).status, 'cancelled');
  assert.deepEqual(h.state.deactivated.map((l) => l.id), [link.id]);
});

test('rule 35 — a platform switch ends the plan and retires its links locally, the poll deactivates them', async () => {
  const h = await withPlan();
  const link = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[1].id);
  h.db.prepare("UPDATE reservations SET platform = 'Booking' WHERE id = ?").run(h.reservationId);
  h.controller.syncAfterSave(h.reservationId, { preArrivalAmount: 1001.5 });
  const retired = h.paymentLinksModel.findById(link.id);
  assert.deepEqual([retired.status, Boolean(retired.remoteCancelPendingAt)], ['cancelled', true]);
  await h.controller.retireChangedLinks(h.reservationId);
  assert.deepEqual(h.state.deactivated.map((l) => l.id), [link.id], 'the leftover link of a plan that is gone is deactivated');
});

test('rule 34 — money paid on a link whose installment is gone is flagged to the admin, never booked or called a double payment', async () => {
  const h = await withPlan();
  const link = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[1].id);
  h.installmentsModel.deletePlan(h.reservationId);
  const notified = [];
  const result = await processPaidLink({
    database: h.db, devisModel: {}, paymentLinksModel: h.paymentLinksModel, link: h.paymentLinksModel.findById(link.id),
    paidPayment: { paid: true, paymentId: 'p', paidAt: '2026-10-28T09:00:00Z' }, notifyPaidAfterCancel: async (l) => notified.push(l.id),
  });
  assert.equal(result.effect, 'installment-unallocated');
  assert.deepEqual(notified, [link.id]);

  const retiredLink = h.paymentLinksModel.create({ reservationId: h.reservationId, type: 'installment', installmentId: 9999, amountCents: 100, providerLinkId: 'ql_x', url: 'u' });
  h.paymentLinksModel.retireForAmountChange(h.reservationId, 'installment', -1, 9999);
  const provider = { ...h.provider, async getPayment() { return { paid: true, paymentId: 'p2', paidAt: '2026-10-29T10:00:00Z' }; } };
  const out = await retryPendingCancellations({
    paymentLinksModel: h.paymentLinksModel, provider, database: h.db, devisModel: {}, notifyPaidAfterCancel: async (l) => notified.push(l.id),
  });
  assert.equal(out.results[0].effect, 'installment-unallocated');
  assert.ok(notified.includes(retiredLink.id));
});

test('rule 35 — the plan resized while the provider answers: the freshly minted link is cancelled and refused', async () => {
  const h = await withPlan();
  const original = h.provider.createLink.bind(h.provider);
  h.provider.createLink = async (args, opts) => {
    const made = await original(args, opts);
    h.installmentsModel.deletePlan(h.reservationId);
    return made;
  };
  await assert.rejects(ensureInstallmentLink(h.deps, h.reservationId, h.rows[1].id), (err) => err.error === 'INSTALLMENT_CHANGED');
  assert.deepEqual(h.provider.calls.cancelled, ['ql_1']);
  assert.equal(h.paymentLinksModel.findOpenForInstallment(h.rows[1].id), undefined);
});

// ── Rule 40 — concurrency ───────────────────────────────────────────────────────────────────────────
test('rule 40 — two clicks on « Envoyer la demande » send one mail and mint one link', async () => {
  const h = await withPlan();
  let sent = 0;
  const gate = {};
  gate.open = new Promise((resolve) => { gate.release = resolve; });
  const deps = { ...h.deps, sendTemplate: async () => { sent += 1; await gate.open; return { sent: true, emailLogId: 1, recipientEmail: 'a@b.c' }; } };
  const first = sendInstallmentRequest(deps, h.reservationId, h.rows[0].id);
  const second = await sendInstallmentRequest(deps, h.reservationId, h.rows[0].id);
  assert.equal(second.httpStatus, 409);
  assert.equal(second.body.error, 'REQUEST_IN_PROGRESS');
  gate.release();
  assert.equal((await first).httpStatus, 200);
  assert.equal(sent, 1);
  assert.equal(h.provider.calls.created.length, 1);
});

test('rule 40 — two concurrent link creations for one installment mint a single link', async () => {
  const h = await withPlan();
  const [a, b] = await Promise.all([
    ensureInstallmentLink(h.deps, h.reservationId, h.rows[0].id),
    ensureInstallmentLink(h.deps, h.reservationId, h.rows[0].id),
  ]);
  assert.equal(h.provider.calls.created.length, 1);
  assert.equal(a.url, b.url);
});

test('rule 40 — a link paid for an installment already collected is a double payment: flagged, not recorded again', async () => {
  const h = await withPlan();
  const link = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[0].id);
  h.installmentsModel.markPaid(h.rows[0].id, { paidDate: TODAY, method: 'cash' });
  const notified = [];
  const result = await processPaidLink({
    database: h.db, devisModel: {}, paymentLinksModel: h.paymentLinksModel, link: h.paymentLinksModel.findById(link.id),
    paidPayment: { paid: true, paymentId: 'p', paidAt: '2026-10-28T09:00:00Z' }, notifyPaidAfterCancel: async (l) => notified.push(l.id),
  });
  assert.equal(result.effect, 'installment-double-payment');
  assert.deepEqual(notified, [link.id]);
  assert.equal(h.installmentsModel.findById(h.rows[0].id).paidMethod, 'cash', 'the first payment is untouched');
});

// ── Rule 39 — the VAT basket of an installment link ─────────────────────────────────────────────────
test('rule 39 — the link carries a VAT basket that adds up to the installment, the tourist tax exempt', async () => {
  const h = await withPlan();
  h.db.prepare('UPDATE reservations SET touristTaxTotal = 31 WHERE id = ?').run(h.reservationId);
  const { __test } = require('../controllers/paymentsController');
  const deps = { ...h.deps, resolveInstallmentItems: (id, installment, plan) => __test.resolveInstallmentComponents(id, installment, plan, h.db) };
  await ensureInstallmentLink(deps, h.reservationId, h.rows[2].id);
  const args = h.provider.calls.created[0];
  assert.ok(args.items && args.items.length >= 2, 'a basket, not the single 0 % line');
  assert.equal(args.expectedTotalCents, 33350);
  const taxLine = args.items.find((item) => /Taxe de séjour/.test(item.title));
  assert.equal(taxLine.vatRate, 0);
  assert.equal(taxLine.amountCents, 3100 - 1034 - 1034, 'the last installment takes what the others left of the tax');
  assert.ok(args.items.some((item) => item.vatRate > 0), 'the rest is taxable at the global rate');
});

// ── Rules 33, 41, 42 — hand-queued request, queue availability ──────────────────────────────────────
async function emailsFixture() {
  const h = await withPlan();
  ensureDefaultEmailTemplates(h.db, { logger: { log() {}, warn() {} } });
  const templateId = h.db.prepare("SELECT id FROM email_templates WHERE stableKey = 'installment_request'").get().id;
  const sentMails = [];
  let providerOn = true;
  const queueModel = buildQueueModel(h.db);
  const installmentRequests = createInstallmentRequests({
    installmentsModel: h.installmentsModel, paymentLinksModel: h.paymentLinksModel,
    paymentProviders: { active: () => (providerOn ? { id: 'qonto' } : null) },
    ensureLink: async (reservationId, installmentId) => ({ url: `https://pay.example/${installmentId}` }),
  });
  const controller = buildEmailsController({
    database: h.db, templatesModel: buildTemplatesModel(h.db), logModel: buildLogModel(h.db), manualQueueModel: queueModel,
    settingsModel: { read: () => ({ companyName: 'D', smtpHost: 's', smtpFromEmail: 'f@x' }), smtpConfigured: () => true, decryptedSmtpSettings: () => ({}) },
    paymentLinksModel: h.paymentLinksModel, installmentRequests, ledger: null, preferences: null,
    emailServiceFactory: () => ({ send: async (m) => { sentMails.push(m); } }),
  });
  return { ...h, templateId, queueModel, controller, sentMails, setProvider: (on) => { providerOn = on; } };
}
const reply = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } });

test('rule 41 — an installment request queued by hand is queued for its installment, and sending it closes the entry', async () => {
  const f = await emailsFixture();
  const queued = reply();
  f.controller.queue({ body: { templateId: f.templateId, reservationId: f.reservationId } }, queued);
  assert.equal(queued.body.queued, true);
  const entries = f.queueModel.listEnriched();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].occurrenceKey, `installment:${f.rows[0].id}`);

  const sent = reply();
  await f.controller.send({ body: { reservationId: f.reservationId, templateId: f.templateId, occurrenceKey: '' } }, sent);
  assert.equal(sent.statusCode, 200);
  assert.deepEqual(f.queueModel.listEnriched(), [], 'the hand-queued entry left the queue');
});

test('rule 42 — without a payment provider a hand-queued installment entry is not proposed either', async () => {
  const f = await emailsFixture();
  f.controller.queue({ body: { templateId: f.templateId, reservationId: f.reservationId } }, reply());
  f.setProvider(false);
  const res = reply();
  f.controller.pending({ query: { today: '2027-05-20' } }, res);
  assert.deepEqual(res.body.filter((r) => r.occurrenceKey), []);
  f.setProvider(true);
  const again = reply();
  f.controller.pending({ query: { today: '2027-05-20' } }, again);
  assert.ok(again.body.some((r) => r.occurrenceKey));
});

// ── Rule 44 hard guard ──────────────────────────────────────────────────────────────────────────────
test('rule 43 — no template that asks for money sends by itself, whatever mode is stored; the editor refuses « auto »', async () => {
  for (const stableKey of PAYMENT_STABLE_KEYS) {
    assert.equal(templateAutoSends({ stableKey, enabled: 1, sendMode: 'auto' }), false, stableKey);
  }
  assert.equal(templateAutoSends({ stableKey: 'arrival_reminder_7d', enabled: 1, sendMode: 'auto' }), true);

  const f = await emailsFixture();
  const templatesModel = buildTemplatesModel(f.db);
  const controller = buildTemplatesController(templatesModel, { read: () => ({}) }, { today: () => TODAY, isLive: () => true });
  const res = reply();
  controller.update({ params: { id: f.templateId }, body: { sendMode: 'auto' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(templatesModel.findById(f.templateId).sendMode, 'manual');
  const ok = reply();
  controller.update({ params: { id: f.templateId }, body: { sendMode: 'manual', name: 'Échéance' } }, ok);
  assert.equal(ok.statusCode, 200);
});

// ── Boot migration on awkward rows ──────────────────────────────────────────────────────────────────
test('the queue rebuild drops a row whose reservation or template is gone instead of failing the boot, and ids stay integers', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT);
    CREATE TABLE email_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
    CREATE TABLE email_log (id INTEGER PRIMARY KEY AUTOINCREMENT, templateId INTEGER, reservationId INTEGER NOT NULL, status TEXT NOT NULL, renderedSubject TEXT NOT NULL, renderedBody TEXT NOT NULL);
    CREATE TABLE email_manual_queue (
      templateId INTEGER NOT NULL, reservationId INTEGER NOT NULL, createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (templateId, reservationId)
    );
    CREATE TABLE payment_links (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      CHECK (type IN ('deposit', 'balance', 'full', 'complement')));
  `);
  db.exec("INSERT INTO reservations (id) VALUES (1); INSERT INTO email_templates (id, name) VALUES (1, 'A');");
  db.exec("INSERT INTO email_manual_queue (templateId, reservationId) VALUES (1, 1), (1, 77), (88, 1);");
  db.exec("INSERT INTO payment_links (reservationId, type) VALUES (1, 'deposit'), (1, 'balance');");
  migrateInstallmentsSchema(db);
  assert.deepEqual(db.prepare('SELECT templateId, reservationId FROM email_manual_queue').all().map((r) => ({ ...r })), [{ templateId: 1, reservationId: 1 }]);
  assert.equal(db.prepare("SELECT typeof(seq) AS t FROM sqlite_sequence WHERE name = 'payment_links'").get().t, 'integer');
  migrateInstallmentsSchema(db);
});
