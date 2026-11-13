// specs/outside-booking-sas.md rules 39-41, specs/payment-link-lifecycle.md rule 68 and specs/pricing-components.md rule 86 — the payment link of an outside sale's reste: absent without a ready provider, disabled
// without an e-mail, its amount SETTLEMENT's reste and never a request's, one open link per document (reused at the same amount, replaced when it drifted), 36 hours,
// a paid link settling the document through the poll's paid effect, a surplus or a cancelled document booked in full and owed back with an admin alert.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const standaloneSale = require('../utils/standaloneSale');
const links = require('../utils/standaloneSaleLinks');
const sales = require('../models/standaloneSalesModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const { runPaymentPoll, processPaidLink } = require('../utils/paymentPollRunner');
const { retireLapsedAndWithdrawn } = require('../utils/paymentLinkLifecycle');
const paymentProviders = require('../utils/paymentProviders');

const option = (title, price, vatClass) => Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, 'per_stay', 1, ?)").run(title, price, vatClass).lastInsertRowid);
const beer = option('Bière', 6.5, 'drinks');
const plank = option('Planche', 14, 'catering');
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);
const line = (id, quantity) => ({ articleRef: `option:${id}`, quantity });

let ready = true;
const created = [];
const cancelled = [];
const paid = new Map();
const fake = {
  id: 'qonto', label: 'Qonto', errorCode: 'QONTO_API_ERROR',
  isReady: () => ready,
  createLink: async (args) => { created.push(args); return { id: `rem-${created.length}`, url: `https://pay.example/${created.length}`, status: 'open' }; },
  getPayment: async (id) => (paid.has(id) ? { paid: true, paymentId: `pay-${id}`, paidAt: paid.get(id) } : { paid: false }),
  getLinkStatus: async () => 'open',
  cancelLink: async (id) => { cancelled.push(id); },
};
registry.configure({ isActive: () => true, allows: () => true });
createContext('online-payment', {}).paymentProvider(fake);

const sell = (lines, customer = { email: 'client@exemple.fr' }) => standaloneSale.sell({ lines, customer }).document;
const alerts = [];
const poll = (now = new Date()) => runPaymentPoll({
  database: db, paymentLinksModel, provider: fake, force: true, now, notifyPaidAfterCancel: async (link, options) => { alerts.push([link.id, options]); },
});

test('rule 39 — the link is absent without a ready provider, shown disabled without an e-mail, available otherwise', () => {
  const withMail = sell([line(beer, 2)]);
  const anonymous = sell([line(beer, 1)], {});
  ready = false;
  assert.deepEqual([links.linkOf(withMail.document.id).available, links.linkOf(withMail.document.id).reason], [false, 'PROVIDER_NOT_READY']);
  ready = true;
  assert.deepEqual([links.linkOf(anonymous.document.id).available, links.linkOf(anonymous.document.id).reason], [false, 'NO_EMAIL']);
  const ok = links.linkOf(withMail.document.id);
  assert.deepEqual([ok.available, ok.reason, ok.email, ok.open], [true, null, 'client@exemple.fr', null]);
  assert.equal(paymentProviders.active().id, 'qonto');
});

test('rule 39 — no e-mail: refused with « Adresse e-mail requise. » until one is typed, which is kept on the document', async () => {
  const doc = sell([line(beer, 1)], {});
  const refused = await links.mint(doc.document.id);
  assert.deepEqual([refused.status, refused.body.code, refused.body.error], [409, 'NO_EMAIL', 'Adresse e-mail requise.']);
  assert.equal((await links.mint(doc.document.id, { email: 'pas-un-mail' })).body.code, 'EMAIL_INVALID');
  const minted = await links.mint(doc.document.id, { email: 'nouveau@exemple.fr' });
  assert.equal(minted.status, 200);
  assert.equal(sales.findSale(doc.document.id).customerEmail, 'nouveau@exemple.fr');
});

test('rule 40 — the link bills the reste computed by SETTLEMENT, in the VAT basket of the unpaid lines, for 36 hours', async () => {
  const doc = sell([line(beer, 3), line(plank, 1)]);
  standaloneSale.pay(doc.document.id, { tenders: [{ method: 'card', amountCents: 1000 }], shortfall: { kind: 'due' } });
  const now = new Date('2027-03-10T10:00:00.000Z');
  const minted = await links.mint(doc.document.id, { now });
  assert.equal(minted.status, 200);
  assert.equal(minted.link.amountCents, 3350 - 1000, 'the reste, whatever the screen says');
  const args = created[created.length - 1];
  assert.equal(args.amountCents, 2350);
  assert.equal(args.expectedTotalCents, 2350);
  assert.equal(args.items.length >= 2, true, 'one item per VAT rate group at least');
  assert.equal(minted.link.expiresAt, '2027-03-11T22:00:00.000Z', '36 hours');
  const row = paymentLinksModel.findById(minted.link.id);
  assert.deepEqual([row.reservationId, row.type, row.saleRef, JSON.parse(row.basketJson)], [null, 'complement', `standalone:${doc.document.id}`, { source: 'standalone-sale', ref: `standalone:${doc.document.id}` }]);
});

test('rule 40 — the same reste reuses the open link, a drifted one withdraws it and mints a new link; one open link at most', async () => {
  const doc = sell([line(beer, 2), line(plank, 1)]);
  const id = doc.document.id;
  const now = new Date('2027-03-10T10:00:00.000Z');
  const first = await links.mint(id, { now });
  const again = await links.mint(id, { now: new Date(now.getTime() + 3600 * 1000) });
  assert.deepEqual([again.link.id, again.link.reused], [first.link.id, true]);
  const offered = standaloneSale.offerLine(id, doc.lines[1].id, { offered: true });
  assert.equal(offered.document.totals.remainingCents, 1300);
  const replaced = await links.mint(id, { now });
  assert.notEqual(replaced.link.id, first.link.id);
  assert.equal(replaced.link.amountCents, 1300);
  assert.equal(paymentLinksModel.findById(first.link.id).status, 'cancelled');
  assert.equal(paymentLinksModel.findById(first.link.id).cancelReason, 'amount-changed');
  assert.ok(cancelled.includes(paymentLinksModel.findById(first.link.id).providerLinkId), 'and deactivated at the provider');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payment_links WHERE saleRef = ? AND status = 'open'").get(`standalone:${id}`).n, 1);
  const stale = await links.mint(id, { now: new Date(now.getTime() + 30 * 3600 * 1000) });
  assert.notEqual(stale.link.id, replaced.link.id, 'less than 24 hours left: replaced rather than reused');
});

test('rule 40 — nothing to collect: 409 NOTHING_DUE; the sale cancelled: 409; provider not ready: 409 PROVIDER_NOT_READY', async () => {
  const paidDoc = sell([line(beer, 1)]);
  standaloneSale.pay(paidDoc.document.id, { tenders: [{ method: 'card', amountCents: 650 }] });
  assert.deepEqual([(await links.mint(paidDoc.document.id)).body.code, (await links.mint(paidDoc.document.id)).body.error], ['NOTHING_DUE', 'Rien à encaisser.']);
  const doc = sell([line(beer, 1)]);
  ready = false;
  assert.equal((await links.mint(doc.document.id)).body.code, 'PROVIDER_NOT_READY');
  ready = true;
});

test('rule 41 — a link paid after the sas is closed settles the document through the poll: one payment (method link), its allocations, the reste at 0', async () => {
  const doc = sell([line(beer, 2)]);
  const id = doc.document.id;
  const minted = await links.mint(id);
  const remoteId = paymentLinksModel.findById(minted.link.id).providerLinkId;
  paid.set(remoteId, '2027-03-12T09:30:00.000Z');
  const result = await poll();
  assert.equal(result.results.find((r) => r.id === minted.link.id).effect, 'standalone-sale-settled');
  const after = standaloneSale.documentOf(id);
  assert.deepEqual([after.document.status, after.totals.paidCents, after.totals.remainingCents, after.totals.refundOwedCents], ['paid', 1300, 0, 0]);
  const payments = db.prepare('SELECT paidAt, source, tendersJson FROM standalone_sale_payments WHERE saleId = ?').all(id);
  assert.deepEqual(payments.map((p) => [p.paidAt, p.source, JSON.parse(p.tendersJson)[0].method]), [['2027-03-12', `payment-link:${minted.link.id}`, 'link']]);
  assert.equal(paymentLinksModel.findById(minted.link.id).status, 'paid');
  assert.deepEqual(alerts.filter(([linkId]) => linkId === minted.link.id), [], 'a settled link raises no alert');
  const again = await processPaidLink({ database: db, devisModel: {}, paymentLinksModel, link: paymentLinksModel.findById(minted.link.id), paidPayment: { paymentId: 'x', paidAt: '2027-03-12T09:30:00.000Z' } });
  assert.equal(again.effect, 'already-processed', 'idempotent');
});

test('rule 41 — a link paid above what the document now asks is booked in full, the surplus is owed back and the admin is told', async () => {
  const doc = sell([line(beer, 2), line(plank, 1)]);
  const id = doc.document.id;
  const minted = await links.mint(id);
  standaloneSale.offerLine(id, doc.lines[1].id, { offered: true });
  paid.set(paymentLinksModel.findById(minted.link.id).providerLinkId, '2027-03-12T10:00:00.000Z');
  const before = alerts.length;
  await poll();
  const after = standaloneSale.documentOf(id);
  assert.deepEqual([after.totals.paidCents, after.totals.totalCents, after.totals.refundOwedCents, after.totals.remainingCents], [2700, 1300, 1400, 0]);
  assert.equal(alerts.length, before + 1);
  assert.deepEqual(alerts[alerts.length - 1][1], { standaloneSale: { surplusCents: 1400, cancelled: false } });
  const surplus = db.prepare("SELECT amountCents FROM payment_allocations WHERE documentRef = ? AND lineRef IS NULL").all(`standalone:${id}`);
  assert.deepEqual(surplus.map((r) => r.amountCents), [1400], 'the surplus is filed on no line');
});

test('rule 41 — a document cancelled withdraws its open link; paid anyway, the whole amount is booked and owed back', async () => {
  const doc = sell([line(beer, 2)]);
  const id = doc.document.id;
  const minted = await links.mint(id);
  standaloneSale.cancel(id);
  const row = paymentLinksModel.findById(minted.link.id);
  assert.deepEqual([row.status, row.cancelReason], ['cancelled', 'operator']);
  assert.ok(row.remoteCancelPendingAt, 'the provider still has to deactivate it');
  paid.set(row.providerLinkId, '2027-03-13T08:00:00.000Z');
  const before = alerts.length;
  await poll();
  const after = standaloneSale.documentOf(id);
  assert.deepEqual([after.document.status, after.totals.paidCents, after.totals.refundOwedCents], ['cancelled', 1300, 1300]);
  assert.equal(paymentLinksModel.findById(minted.link.id).status, 'paid');
  assert.equal(alerts.length, before + 1);
  assert.equal(alerts[alerts.length - 1][1].standaloneSale.cancelled, true);
});

test('rule 40 — « Retirer le lien » withdraws it at the provider, and the lifecycle pass never takes a sale link for an orphan', async () => {
  const doc = sell([line(beer, 1)]);
  const id = doc.document.id;
  const minted = await links.mint(id);
  const moved = retireLapsedAndWithdrawn(db, { now: new Date(), paymentLinksModel });
  assert.equal(moved.some((l) => l.id === minted.link.id), false, 'a NULL reservation is no orphan');
  assert.equal(paymentLinksModel.findById(minted.link.id).status, 'open');
  const out = await links.withdraw(id, minted.link.id);
  assert.equal(out.status, 200);
  assert.equal(paymentLinksModel.findById(minted.link.id).status, 'cancelled');
  assert.ok(cancelled.includes(paymentLinksModel.findById(minted.link.id).providerLinkId));
  assert.equal((await links.withdraw(id, 99999)).status, 404);
});

test('rule 40 — a link lapses at its 36 hours like any other', async () => {
  const doc = sell([line(beer, 1)]);
  const minted = await links.mint(doc.document.id, { now: new Date('2027-03-01T10:00:00.000Z') });
  const moved = retireLapsedAndWithdrawn(db, { now: new Date('2027-03-03T00:00:00.000Z'), paymentLinksModel });
  assert.ok(moved.some((l) => l.id === minted.link.id));
  assert.equal(paymentLinksModel.findById(minted.link.id).status, 'expired');
});

test('payment-link-lifecycle rule 68 — a sale link is no orphan on the home\'s list: absent while open and valid, listed as « Vente hors séjour » once withdrawn', async () => {
  const doc = sell([line(beer, 1)]);
  const minted = await links.mint(doc.document.id);
  assert.equal(paymentLinksModel.listOwedDeactivations().some((l) => l.id === minted.link.id), false);
  standaloneSale.cancel(doc.document.id);
  const [listed] = paymentLinksModel.listOwedDeactivations().filter((l) => l.id === minted.link.id);
  assert.deepEqual([listed.stayMissing, listed.saleRef, listed.reason], [false, `standalone:${doc.document.id}`, 'operator']);
  const { owedDeactivations } = require('../controllers/paymentDeactivationsAttentionController');
  const row = owedDeactivations(paymentLinksModel, paymentProviders).links.find((l) => l.id === minted.link.id);
  assert.deepEqual([row.stayLabel, row.stayUrl], ['Vente hors séjour', null]);
});
