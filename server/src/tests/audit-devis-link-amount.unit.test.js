// specs/public-online-payment.md rules 14-15 (audit 2026-10-28, public/payments) — a devis link paid for another amount than the quote asks:
//  - a re-priced devis retires its stale open links (finding 1a);
//  - a stale link paid anyway books what was really received and alerts the admin (finding 1b),
//    including the full links minted before the tourist tax joined the amount ;
//  - two live links of one devis: the second payment is a refund alert, never a second booking (finding 2).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { processPaidLink } = require('../utils/paymentPollRunner');
const { deactivateAbandonedLinks } = require('../utils/paymentLinkDeactivation');
const { ensurePaymentLink } = require('../utils/paymentRequestService');
const notificationService = require('../utils/notificationService');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed({ deposit = 100, balance = 355.36 } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults,
      finalPrice, depositAmount, balanceAmount, devisStatus)
    VALUES ('devis', 1, 1, '2027-05-10', '2027-05-14', 1, ?, ?, ?, 'draft')`).run(deposit + balance, deposit, balance).lastInsertRowid);
  return { db, id, links: paymentLinksModel.buildModel(db) };
}

const reprice = (db, id, deposit, balance) => db.prepare('UPDATE reservations SET depositAmount = ?, balanceAmount = ?, finalPrice = ? WHERE id = ?').run(deposit, balance, deposit + balance, id);

// retireSettled is off on purpose: these cases pay two still-open links, the race of two webhooks. The
// retired-link path is covered by payment-links-converted-devis-double-payment.unit.test.js (payRetired).
async function pay(db, links, link, extra = {}) {
  const alerts = [];
  const confirmations = [];
  const out = await processPaidLink({
    database: db, devisModel: devisModel.buildModel(db), paymentLinksModel: Object.assign(Object.create(links), { retireSettled: () => [] }), link: links.findById(link.id),
    paidPayment: { paid: true, paymentId: `pay_${link.id}`, paidAt: '2027-04-01T10:00:00Z' },
    sendConfirmation: async (rid) => confirmations.push(rid),
    notifyPaidAfterCancel: async (l, o) => alerts.push(o),
    emitPluginEvent: () => {},
    ...extra,
  });
  return { out, alerts, confirmations };
}

test('finding 1b — the 22327 scenario: an old cheaper full link paid after the quote grew books what was received', async () => {
  const { db, id, links } = seed({ deposit: 0, balance: 463.12 });
  const link = links.create({ reservationId: id, type: 'full', amountCents: 46312, providerLinkId: 'old', url: 'u', status: 'open' });
  reprice(db, id, 0, 610.12);

  const { out, alerts, confirmations } = await pay(db, links, link);
  const resa = db.prepare('SELECT depositPaid, balancePaid, balanceAmount, complementAmount FROM reservations WHERE id = ?').get(out.reservationId);

  assert.deepEqual(out.amountMismatch, { expectedCents: 61012, receivedCents: 46312 });
  assert.equal(Number(resa.balanceAmount), 463.12, 'the solde is what was received');
  assert.equal(Number(resa.complementAmount), 147, 'the shortfall stays due');
  assert.deepEqual(alerts, [{ amountMismatch: { expectedCents: 61012, receivedCents: 46312 } }]);
  assert.deepEqual(confirmations, [], 'no « paid in full » mail for a short payment');
});

test('finding 1b — a full link minted before the tourist tax joined the amount (545,36 vs 555,00)', async () => {
  const { db, id, links } = seed({ deposit: 100, balance: 455 });
  const link = links.create({ reservationId: id, type: 'full', amountCents: 54536, providerLinkId: 'pre18', url: 'u', status: 'open' });

  const { out, alerts } = await pay(db, links, link);
  const resa = db.prepare('SELECT depositPaid, balancePaid, depositAmount, balanceAmount, complementAmount FROM reservations WHERE id = ?').get(out.reservationId);

  assert.equal(out.amountMismatch.expectedCents, 55500);
  assert.equal(Number(resa.depositAmount) + Number(resa.balanceAmount), 545.36);
  assert.equal(Number(resa.complementAmount), 9.64, 'the tax remainder is left due');
  assert.equal(Number(resa.depositPaid), 1);
  assert.equal(Number(resa.balancePaid), 1);
  assert.equal(alerts.length, 1);
});

test('finding 1b — a link that bills the current amount converts and ticks exactly as before, no alert', async () => {
  const { db, id, links } = seed();
  const link = links.create({ reservationId: id, type: 'full', amountCents: 45536, providerLinkId: 'ok', url: 'u', status: 'open' });
  const { out, alerts, confirmations } = await pay(db, links, link);
  assert.equal(out.effect, 'converted');
  assert.equal(out.amountMismatch, undefined);
  assert.deepEqual(alerts, []);
  assert.equal(confirmations.length, 1);
});

test('finding 1a — re-pricing a devis retires its stale open links and keeps the right ones', async () => {
  const { db, id, links } = seed({ deposit: 0, balance: 463.12 });
  const model = devisModel.buildModel(db);
  const stale = links.create({ reservationId: id, type: 'full', amountCents: 46312, providerLinkId: 'old', url: 'u', status: 'open' });
  const calls = [];
  // The model's own update needs the pricing engine; its retire step is what the save path calls.
  reprice(db, id, 0, 610.12);
  const retired = model.__retireStaleLinks(id);
  assert.deepEqual(retired.map((l) => l.id), [stale.id]);
  const row = links.findById(stale.id);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.cancelReason, 'amount-changed');
  assert.ok(row.remoteCancelPendingAt);

  const provider = { id: 'qonto', cancelLink: async (pid) => calls.push(pid), getLinkStatus: async () => 'open' };
  await deactivateAbandonedLinks(retired, { paymentLinksModel: links, providerFor: () => provider });
  assert.deepEqual(calls, ['old'], 'the provider link is deactivated');
  assert.equal(links.findById(stale.id).remoteCancelPendingAt, null);

  const fresh = links.create({ reservationId: id, type: 'full', amountCents: 61012, providerLinkId: 'new', url: 'u', status: 'open' });
  assert.deepEqual(model.__retireStaleLinks(id), [], 'a link at the current amount is untouched');
  assert.equal(links.findById(fresh.id).status, 'open');
});

test('finding 2 — two concurrent /pay on one devis mint one provider link', async () => {
  const { db, id, links } = seed();
  let created = 0;
  const provider = { id: 'qonto', async createLink() { created += 1; const k = created; await new Promise((r) => setTimeout(r, 30)); return { id: `p${k}`, url: `https://pay/${k}`, status: 'open' }; } };
  const deps = { database: db, paymentLinksModel: links, provider, resolveAmountCents: () => 45536, deactivateLinks: async () => {} };
  const [a, b] = await Promise.all([ensurePaymentLink(deps, id, 'full'), ensurePaymentLink(deps, id, 'full')]);
  assert.equal(created, 1);
  assert.equal(a.id, b.id);
  assert.equal(b.reused, true);
});

test('finding 2 — a second paid link on an already-converted, already-paid devis is a refund alert, not a second booking', async () => {
  const { db, id, links } = seed();
  const first = links.create({ reservationId: id, type: 'full', amountCents: 45536, providerLinkId: 'l1', url: 'u', status: 'open' });
  const second = links.create({ reservationId: id, type: 'full', amountCents: 45536, providerLinkId: 'l2', url: 'u', status: 'open' });
  const one = await pay(db, links, first);
  assert.equal(one.out.effect, 'converted');
  const two = await pay(db, links, second);
  assert.equal(two.out.effect, 'double-payment');
  assert.deepEqual(two.alerts, [{ doublePaid: true }]);
  assert.deepEqual(two.confirmations, [], 'no second confirmation mail');
});

test('the admin alert names the amounts for a mismatch and the double payment', () => {
  const { buildPaidAfterCancelEmail } = notificationService.__test;
  const resa = { id: 1, devisNumber: 'D-1', propertyName: 'Gite', startDate: '2027-05-10', endDate: '2027-05-14' };
  const mismatch = buildPaidAfterCancelEmail(resa, { amountCents: 46312 }, '', { amountMismatch: { expectedCents: 61012 } });
  assert.match(mismatch.subject, /autre montant/);
  assert.match(mismatch.text, /610,12/);
  assert.match(buildPaidAfterCancelEmail(resa, { amountCents: 100 }, '', { doublePaid: true }).subject, /deux fois/);
});

// specs/plugins-phase-3a-online-payment.md rule 47 (audit R6 D1): an acompte link paid at another amount books the acompte
// at what was received and the solde absorbs the gap; the alert says so, owes no complement nor trop-perçu, and the
// confirmation goes out.
for (const [deposit, balance, label] of [[120, 335.36, 'grown'], [80, 375.36, 'shrunk']]) {
  // specs/plugins-phase-3a-online-payment.md rule 47
  test(`rule 47 — devis acompte link, acompte ${label}: the alert states the booking, the confirmation is sent`, async () => {
    const { db, id, links } = seed({ deposit: 100, balance: 355.36 });
    const link = links.create({ reservationId: id, type: 'deposit', amountCents: 10000, providerLinkId: 'old', url: 'u', status: 'open' });
    reprice(db, id, deposit, balance);

    const { out, alerts, confirmations } = await pay(db, links, link);
    const resa = db.prepare('SELECT depositAmount, balanceAmount, complementAmount FROM reservations WHERE id = ?').get(out.reservationId);
    assert.equal(Number(resa.depositAmount), 100);
    assert.equal(Number(resa.balanceAmount), 355.36);
    assert.equal(Number(resa.complementAmount || 0), 0);
    assert.equal(confirmations.length, 1);
    assert.equal(alerts.length, 1);
    const { text } = notificationService.__test.buildPaidAfterCancelEmail(db.prepare('SELECT * FROM reservations WHERE id = ?').get(id), links.findById(link.id), '', alerts[0]);
    assert.match(text, new RegExp(`Acompte enregistré à 100,00\\s€ \\(${deposit},00\\s€ demandés\\) ; solde porté à 355,36\\s€\\.`));
    assert.doesNotMatch(text, /Trop-perçu|complément d’arrivée/);
  });
}

// specs/plugins-phase-3a-online-payment.md rule 47 (audit R6 E2)
test('rule 47 (E2): a retired acompte link of a devis paid after a re-price tells the operator no confirmation was sent', async () => {
  const { db, id, links } = seed({ deposit: 100, balance: 355.36 });
  const link = links.create({ reservationId: id, type: 'deposit', amountCents: 10000, provider: 'qonto', providerLinkId: 'old', url: 'u', status: 'open' });
  reprice(db, id, 120, 335.36);
  links.retireForAmountChange(id, 'deposit', 12000);
  const alerts = [];
  const confirmations = [];
  const provider = { id: 'qonto', async getPayment() { return { paid: true, paymentId: 'pOld', paidAt: '2027-04-01T12:00:00Z' }; }, async cancelLink() {} };
  const { retryPendingCancellations } = require('../utils/paymentPollRunner');
  await retryPendingCancellations({
    database: db, devisModel: devisModel.buildModel(db), paymentLinksModel: links, provider,
    sendConfirmation: async (rid) => confirmations.push(rid), notifyPaidAfterCancel: async (l, o) => alerts.push(o), emitPluginEvent: () => {},
  });
  assert.equal(confirmations.length, 0);
  assert.equal(alerts.length, 1);
  const { text } = notificationService.__test.buildPaidAfterCancelEmail(db.prepare('SELECT * FROM reservations WHERE id = ?').get(id), links.findById(link.id), '', alerts[0]);
  assert.match(text, /Acompte enregistré à 100,00\s€ \(120,00\s€ demandés\) ; solde porté à 355,36\s€\./);
  assert.match(text, /Aucun e-mail de confirmation n’a été envoyé au client\. À vérifier : envoyer la confirmation au client\./s);
});
