// specs/payment-link-lifecycle.md rules 3-4 — a payment that lands on a link whose stay row is gone (an
// orphan) is kept on the link as a money record, books nothing, confirms nothing, and alerts the admin
// with an e-mail and a push that carry the link's facts and no URL (there is no fiche to open).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { runPaymentPoll, processPaidLink, retryPendingCancellations } = require('../utils/paymentPollRunner');
const { buildNotificationService } = require('../utils/notificationService');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const FORMER_STAY = 4242;
const PAID_AT = '2026-10-29T09:15:00Z';

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Test', 'Client', 'client@example.test')").run();
  const links = paymentLinksModel.buildModel(db);
  return { db, links };
}

function provider({ paid = true, paidAt = PAID_AT } = {}) {
  const calls = [];
  return {
    calls,
    id: 'qonto',
    getPayment: async (linkId, opts) => { calls.push(['getPayment', linkId, opts && opts.origin]); return paid ? { paid: true, paymentId: 'pay_orphan', paidAt } : { paid: false }; },
    getLinkStatus: async () => 'open',
    cancelLink: async (linkId) => { calls.push(['cancelLink', linkId]); },
  };
}

function spies() {
  const notified = [];
  const confirmed = [];
  return {
    notified,
    confirmed,
    notifyPaidAfterCancel: async (l, o) => { notified.push([l.id, o]); },
    sendConfirmation: async (id) => { confirmed.push(id); },
    recordPayment: () => { throw new Error('an orphan payment is never booked'); },
    checkConflict: () => { throw new Error('no conflict check without a stay'); },
  };
}

// The poll opens with the lifecycle pass (specs/payment-link-lifecycle.md rules 13, 16): an open orphan is
// withdrawn there, so the poll finds its payment on the retry path.
test('rule 3 — poll: an open orphan link paid at the provider is withdrawn, keeps the payment, books nothing, confirms nothing, alerts', async () => {
  const { db, links } = seed();
  const link = links.create({ reservationId: FORMER_STAY, type: 'full', amountCents: 76280, providerLinkId: 'pl_full' });
  const s = spies();
  const summary = await runPaymentPoll({ database: db, paymentLinksModel: links, provider: provider(), devisModel: devisModel.buildModel(db), force: true, ...s });

  const row = links.findById(link.id);
  assert.equal(row.status, 'cancelled', 'withdrawn as an orphan; the money record stays on the link');
  assert.equal(row.cancelReason, 'orphan');
  assert.equal(row.providerPaymentId, 'pay_orphan');
  assert.equal(row.paidAt, PAID_AT);
  assert.deepEqual(s.confirmed, [], 'no confirmation');
  assert.equal(s.notified.length, 1);
  assert.equal(s.notified[0][0], link.id);
  assert.equal(s.notified[0][1].orphan, true);
  assert.equal(s.notified[0][1].paidAt, PAID_AT);
  assert.equal(s.notified[0][1].providerPaymentId, 'pay_orphan');
  const res = summary.results.find((r) => r.id === link.id);
  assert.equal(res.effect, 'no-reservation');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservations').get().n, 0, 'nothing created');
});

test('rule 3 — live path: the webhook (processPaidLink) on an orphan deposit link alerts once, a replay does nothing', async () => {
  const { db, links } = seed();
  const link = links.create({ reservationId: FORMER_STAY, type: 'deposit', amountCents: 21494, providerLinkId: 'pl_dep' });
  const s = spies();
  const deps = { database: db, devisModel: devisModel.buildModel(db), paymentLinksModel: links, link, paidPayment: { paymentId: 'pay_orphan', paidAt: PAID_AT }, emitPluginEvent: () => {}, ...s };
  const first = await processPaidLink(deps);
  const replay = await processPaidLink(deps);
  assert.equal(first.effect, 'no-reservation');
  assert.equal(replay.effect, 'already-processed');
  assert.equal(s.notified.length, 1, 'one alert, never twice');
  assert.equal(s.notified[0][1].orphan, true);
  assert.deepEqual(s.confirmed, [], 'a deposit link would confirm a stay: not an orphan one');
  assert.equal(links.findById(link.id).status, 'paid');
});

// Every branch of the rule-8 retry: whatever the reason the link was withdrawn, a missing stay is
// checked first (rule 3, "every branch").
for (const variant of [
  { name: 'orphan', type: 'full', cancelReason: 'orphan' },
  { name: 'settled', type: 'balance', cancelReason: 'settled' },
  { name: 'amount-changed', type: 'deposit', cancelReason: 'amount-changed' },
  { name: 'amount-changed installment', type: 'installment', cancelReason: 'amount-changed', installmentId: 77 },
  { name: 'a stay cancellation (no reason)', type: 'full', cancelReason: null },
]) {
  test(`rule 3 — retry path, ${variant.name}: paid on a missing stay → kept cancelled with the payment, nothing booked, orphan alert`, async () => {
    const { db, links } = seed();
    const link = links.create({ reservationId: FORMER_STAY, type: variant.type, amountCents: 67280, providerLinkId: 'pl_r', installmentId: variant.installmentId });
    db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = ?, remoteCancelPendingAt = '2026-10-29T08:00:00Z' WHERE id = ?").run(variant.cancelReason, link.id);
    const s = spies();
    const p = provider();
    const { results } = await retryPendingCancellations({ paymentLinksModel: links, provider: p, database: db, devisModel: devisModel.buildModel(db), logger: { log() {}, warn() {} }, ...s });

    const row = links.findById(link.id);
    assert.equal(row.status, 'cancelled', 'a withdrawn row stays cancelled (rule 8)');
    assert.equal(row.providerPaymentId, 'pay_orphan');
    assert.equal(row.paidAt, PAID_AT);
    assert.equal(row.remoteCancelPendingAt, null, 'nothing left to retry');
    assert.deepEqual(p.calls.map((c) => c[0]), ['getPayment'], 'a paid link is not deactivated');
    assert.equal(s.notified.length, 1);
    assert.equal(s.notified[0][1].orphan, true);
    assert.deepEqual(s.confirmed, []);
    const res = results.find((r) => r.id === link.id);
    assert.equal(res.status, 'paid-after-cancel');
    assert.equal(res.effect, 'no-reservation');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reservation_installments').get().n, 0, 'no installment touched');
  });
}

test('rule 5 — retry path: an orphan not paid is deactivated and the outcome is logged per link', async () => {
  const { db, links } = seed();
  const link = links.create({ reservationId: FORMER_STAY, type: 'full', amountCents: 76280, providerLinkId: 'pl_open' });
  db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'orphan', remoteCancelPendingAt = '2026-10-29T08:00:00Z' WHERE id = ?").run(link.id);
  const s = spies();
  const p = provider({ paid: false });
  const logged = [];
  const { results } = await retryPendingCancellations({ paymentLinksModel: links, provider: p, database: db, logger: { log: (m) => logged.push(m), warn: (m) => logged.push(m) }, ...s });
  assert.deepEqual(p.calls.map((c) => c[0]), ['getPayment', 'cancelLink']);
  assert.equal(results.find((r) => r.id === link.id).status, 'deactivated');
  assert.equal(links.findById(link.id).remoteCancelPendingAt, null);
  assert.deepEqual(s.notified, []);
  assert.deepEqual(logged, [`[payments] orphan link #${link.id} deactivated at qonto`]);
});

test('rule 3 — retry path: the stay vanishing while an amount-changed booking is claimed still ends on the orphan alert', async () => {
  const { db, links } = seed();
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount)
    VALUES ('reservation', 1, 1, '2026-11-10', '2026-11-12', 2, 300, 90, 210)`).run().lastInsertRowid);
  const link = links.create({ reservationId: id, type: 'deposit', amountCents: 8000, providerLinkId: 'pl_race' });
  db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'amount-changed', remoteCancelPendingAt = '2026-10-29T08:00:00Z' WHERE id = ?").run(link.id);
  // The stay is deleted between the up-front check and the booking (ledgerLinks answers `no-reservation`).
  const racing = { ...links, claimRemoteCancelPending: (linkId) => { db.prepare('DELETE FROM reservations WHERE id = ?').run(id); return links.claimRemoteCancelPending(linkId); } };
  const s = spies();
  const { results } = await retryPendingCancellations({ paymentLinksModel: racing, provider: provider(), database: db, devisModel: devisModel.buildModel(db), logger: { log() {}, warn() {} }, ...s });
  assert.equal(results.find((r) => r.id === link.id).effect, 'no-reservation');
  assert.equal(s.notified.length, 1);
  assert.equal(s.notified[0][1].orphan, true);
  const row = links.findById(link.id);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.providerPaymentId, 'pay_orphan');
});

// ── rule 4 — the notification itself ────────────────────────────────────────

function notifier({ publicUrl = 'https://app.example.test' } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT, devisNumber TEXT, clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, sourceIcalSourceId INTEGER);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, name TEXT);
  `);
  const sent = [];
  const pushes = [];
  const svc = buildNotificationService({
    db,
    settingsModel: {
      notificationSettings: () => ({ enabled: true, recipientEmail: 'owner@example.test', fromEmail: 'noreply@example.test', publicUrl }),
      smtpConfigured: () => true,
      decryptedSmtpSettings: () => ({ host: 'smtp' }),
    },
    emailServiceFactory: () => ({ isConfigured: true, send: async (msg) => { sent.push(msg); } }),
    pushService: { sendToPref: async (pref, payload) => { pushes.push([pref, payload]); } },
    logger: { warn() {}, log() {} },
  });
  return { svc, sent, pushes };
}

const ORPHAN_LINK = { id: 13, reservationId: FORMER_STAY, type: 'full', amountCents: 76280, provider: 'qonto', providerLinkId: 'pl_full_13', createdAt: '2026-10-20 08:30:00' };
const flat = (s) => String(s).replace(/[  ]/g, ' ');

test('rule 4 — orphan: true sends a push and an e-mail with the link facts, the action line and no URL', async () => {
  const { svc, sent, pushes } = notifier();
  const out = await svc.notifyPaidAfterCancel(ORPHAN_LINK, { orphan: true, paidAt: PAID_AT, providerPaymentId: 'pay_orphan' });
  assert.deepEqual(out, { sent: true });
  assert.equal(sent.length, 1);
  assert.equal(flat(sent[0].subject), 'Paiement reçu sur un lien sans séjour — 762,80 €');
  const text = flat(sent[0].text);
  for (const fact of ['#13', 'séjour', '762,80 €', '20/10/2026', '29/10/2026', 'pl_full_13', 'pay_orphan', `${FORMER_STAY}`, 'séjour supprimé',
    'Action requise : retrouver le client et rembourser ce paiement depuis votre espace du prestataire de paiement.']) {
    assert.ok(text.includes(fact), `body names « ${fact} »`);
  }
  assert.ok(!/https?:\/\//.test(text), 'no URL in the body');
  assert.ok(!text.includes('/reservations/'), 'no fiche path in the body');
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0][1].url, undefined, 'the push carries no url');
  assert.ok(!('url' in pushes[0][1]));
  assert.equal(flat(pushes[0][1].title), 'Paiement reçu sur un lien sans séjour');
});

test('rule 4 — a missing stay alerts whatever the options (never skipped as not_found)', async () => {
  const { svc, sent, pushes } = notifier();
  const out = await svc.notifyPaidAfterCancel({ ...ORPHAN_LINK, type: 'installment', paidAt: PAID_AT, providerPaymentId: 'pay_x' });
  assert.deepEqual(out, { sent: true });
  assert.equal(pushes.length, 1);
  const text = flat(sent[0].text);
  assert.ok(text.includes('échéance'), 'the type is worded');
  assert.ok(text.includes('pay_x'), 'falls back on the link row for the payment id');
});

test('rule 4 — the type is worded acompte / solde / séjour / échéance', () => {
  const { svc } = notifier();
  const { buildOrphanPaidEmail } = svc.__test;
  const words = ['deposit', 'balance', 'full', 'installment'].map((type) => flat(buildOrphanPaidEmail({ ...ORPHAN_LINK, type }, {}).text));
  assert.ok(words[0].includes('Type : acompte'));
  assert.ok(words[1].includes('Type : solde'));
  assert.ok(words[2].includes('Type : séjour'));
  assert.ok(words[3].includes('Type : échéance'));
});

test('rule 4 — best-effort: notifications off still pushes, never throws', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE reservations (id INTEGER PRIMARY KEY, clientId INTEGER, propertyId INTEGER, sourceIcalSourceId INTEGER); CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT); CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, name TEXT);');
  const pushes = [];
  const svc = buildNotificationService({
    db,
    settingsModel: { notificationSettings: () => ({ enabled: false }), smtpConfigured: () => true, decryptedSmtpSettings: () => ({}) },
    emailServiceFactory: () => { throw new Error('never built'); },
    pushService: { sendToPref: async (pref, payload) => { pushes.push(payload); } },
    logger: { warn() {}, log() {} },
  });
  const out = await svc.notifyPaidAfterCancel(ORPHAN_LINK, { orphan: true });
  assert.deepEqual(out, { sent: false, skipped: 'disabled' });
  assert.equal(pushes.length, 1);
});

test('rule 4 — a provider answering paid without paid_at: the alert carries the same « Payé le » the row was stamped with', async () => {
  for (const retry of [false, true]) {
    const { db, links } = seed();
    const link = links.create({ reservationId: FORMER_STAY, type: 'full', amountCents: 76280, providerLinkId: 'pl_full' });
    if (retry) db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'orphan', remoteCancelPendingAt = ? WHERE id = ?").run(PAID_AT, link.id);
    const s = spies();
    await runPaymentPoll({ database: db, paymentLinksModel: links, provider: provider({ paidAt: null }), devisModel: devisModel.buildModel(db), force: true, ...s });
    const row = links.findById(link.id);
    assert.ok(row.paidAt, `${retry ? 'retry' : 'live'}: the row is stamped`);
    assert.equal(s.notified.length, 1);
    assert.equal(s.notified[0][1].paidAt, row.paidAt, `${retry ? 'retry' : 'live'}: the alert states the stamped day`);
  }
});
