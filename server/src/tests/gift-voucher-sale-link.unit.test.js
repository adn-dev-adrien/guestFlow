// specs/gift-vouchers.md rules 16-17 — what the core gives a plugin for a sale with no stay (SDK 2.32.0, generic, the word « voucher »
// appears only in the plugin under test): a link with no reservation billed to `<source>:<ref>`, never withdrawn as an orphan, whose paid
// effect is the owning plugin's `ctx.paymentBasket` — with `reservationId` null — and idempotent. The full chain runs on the real core
// database: the plugin mints the link through `core.payments.saleLink`, the poll's `processPaidLink` settles it, the voucher is issued.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../plugins/sdk/testing');

if (!requirePlugins(['gift-vouchers'])) return;

const db = require('../database');
const sdk = require('../plugins/sdk');
const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const { applyPluginSchema } = require('../plugins/sdk/testing');
const paymentLinksModel = require('../models/paymentLinksModel');
const { processPaidLink, applyPaidEffect, retryPendingCancellations } = require('../utils/paymentPollRunner');
const { retireLapsedAndWithdrawn } = require('../utils/paymentLinkLifecycle');
const { buildGiftVouchersApi, memorySettings } = require('../plugins/gift-vouchers');
const { SOURCE } = require('../plugins/gift-vouchers/orderPaid');

applyPluginSchema(db, 'gift-vouchers');

const paidAt = new Map();
const created = [];
const cancelled = [];
let ready = true;
const provider = {
  id: 'qonto',
  label: 'Qonto',
  errorCode: 'QONTO_API_ERROR',
  isReady: () => ready,
  createLink: async (args) => { created.push(args); return { id: `rem-${created.length}`, url: `https://pay.example.test/${created.length}`, status: 'open' }; },
  getPayment: async (id) => (paidAt.has(id) ? { paid: true, paymentId: `pay-${id}`, paidAt: paidAt.get(id) } : { paid: false }),
  getLinkStatus: async () => 'open',
  cancelLink: async (id) => { cancelled.push(id); },
};

function liveOwner(paid) {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  createContext('online-payment', {}).paymentProvider(provider);
  if (paid) createContext('gift-vouchers', {}).paymentBasket({ source: SOURCE, paid });
}

const clock = { at: new Date('2026-11-15T10:00:00Z') };
const sent = [];
const api = buildGiftVouchersApi({
  db,
  pepper: () => 'test-pepper',
  encrypt: sdk.coreModule('encryption').encrypt,
  decrypt: sdk.coreModule('encryption').safeDecrypt,
  settingsStore: () => memorySettings(),
  now: () => clock.at,
  quote: () => null,
  pow: sdk.proofOfWork,
  powSecret: () => 's',
  guard: (req, res, next) => next(),
  sendMail: async (mail) => { sent.push(mail); return {}; },
  paymentMethods: () => [],
  companyName: () => 'Domaine',
  pageUrl: () => 'https://site.example.test/bon',
  bookingUrl: () => 'https://site.example.test/reserver',
  termsVersionId: () => null,
  onlineSaleAvailable: () => true,
  siteOrigin: () => 'https://site.example.test',
  payments: {
    saleLink: (sale, options) => sdk.core.payments.saleLink({ source: SOURCE, ...sale }, options),
    refreshLink: (linkId) => sdk.core.payments.refreshBasketLink(linkId),
  },
});

const newOrder = (amountCents = 15000) => api.orders.create({
  amountCents, email: 'paul@example.test', source: 'site', termsAcceptedAt: clock.at.toISOString(),
});
const mint = (order, amountCents = 15000) => sdk.core.payments.saleLink(
  { source: SOURCE, ref: order.id, title: `Bon cadeau de ${amountCents / 100} €`, amountCents },
  { redirectUrl: `https://site.example.test/bon?gf_voucher=${order.id}` },
);
const pay = (linkId, at = '2026-11-15T10:05:00Z') => processPaidLink({
  database: db, devisModel: {}, paymentLinksModel, link: paymentLinksModel.findById(linkId), paidPayment: { paymentId: `pay-${linkId}`, paidAt: at },
});
const vouchers = () => db.prepare('SELECT * FROM gift_vouchers').all();

test('SDK 2.32.0: a sale link has no reservation — it bills `<source>:<ref>` at the exact amount, back to the page, for 30 minutes', async () => {
  liveOwner(api.orderPaid);
  const order = newOrder(15050);
  const link = await mint(order, 15050);
  const row = paymentLinksModel.findById(link.linkId);
  assert.deepEqual([row.reservationId, row.type, row.saleRef, row.amountCents, row.status], [null, 'complement', `${SOURCE}:${order.id}`, 15050, 'open']);
  assert.deepEqual(JSON.parse(row.basketJson), { source: SOURCE, ref: String(order.id) });
  assert.deepEqual(created.at(-1), { title: 'Bon cadeau de 150.5 €', amountCents: 15050, redirectUrl: `https://site.example.test/bon?gf_voucher=${order.id}` });
  const minutes = (Date.parse(row.expiresAt) - Date.now()) / 60000;
  assert.ok(minutes > 29 && minutes <= 30, `${minutes} minutes`);
  assert.equal(link.reused, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n, 0, 'no stay, no devis');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clients').get().n, 0, 'no client fiche');
});

test('SDK 2.32.0: asking again hands back the open link while it has time; with little time or another amount, the old link is retired and a new one minted', async () => {
  liveOwner(api.orderPaid);
  const order = newOrder();
  const first = await mint(order);
  const again = await mint(order);
  assert.deepEqual([again.linkId, again.reused], [first.linkId, true]);
  db.prepare("UPDATE payment_links SET expiresAt = ? WHERE id = ?").run(new Date(Date.now() + 2 * 60 * 1000).toISOString(), first.linkId);
  const second = await mint(order);
  assert.notEqual(second.linkId, first.linkId);
  assert.equal(paymentLinksModel.findById(first.linkId).status, 'expired', 'a link about to lapse is retired, so only the newest can be paid');
  const third = await mint(order, 20000);
  assert.equal(paymentLinksModel.findById(second.linkId).status, 'cancelled');
  assert.equal(paymentLinksModel.findById(third.linkId).amountCents, 20000);
  assert.equal(paymentLinksModel.findOpenForSale(`${SOURCE}:${order.id}`).id, third.linkId);
});

test('SDK 2.32.0: a sale link is refused without a title, an amount or a source, and without a provider — nothing is asked of the provider', async () => {
  liveOwner(api.orderPaid);
  const before = created.length;
  for (const sale of [{ source: SOURCE, ref: 1, title: '', amountCents: 100 }, { source: SOURCE, ref: 1, title: 'x', amountCents: 0 }, { source: SOURCE, ref: 1, title: 'x', amountCents: 10.5 }, { source: SOURCE, title: 'x', amountCents: 100 }, { source: '', ref: 1, title: 'x', amountCents: 100 }]) {
    await assert.rejects(sdk.core.payments.saleLink(sale), (e) => e.httpStatus === 400 && e.error === 'BASKET_REQUIRED');
  }
  registry.reset();
  await assert.rejects(sdk.core.payments.saleLink({ source: SOURCE, ref: 1, title: 'x', amountCents: 100 }), (e) => e.httpStatus === 409 && e.error === 'NO_PAYMENT_PROVIDER');
  assert.equal(created.length, before);
});

test('SDK 2.32.0: a link with no stay is no orphan — the lifecycle pass keeps it open, and the alert of links to deactivate does not list it', async () => {
  liveOwner(api.orderPaid);
  const order = newOrder();
  const link = await mint(order);
  retireLapsedAndWithdrawn(db, { now: new Date() });
  assert.equal(paymentLinksModel.findById(link.linkId).status, 'open');
  assert.equal(paymentLinksModel.listOwedDeactivations({ now: new Date() }).some((l) => l.id === link.linkId), false);
});

test('rule 17: a link the bank says is paid issues the voucher in the plugin — called with no reservation — and the receipt leaves', async () => {
  const calls = [];
  liveOwner((event) => { calls.push(event); return api.orderPaid(event); });
  const order = newOrder();
  const link = await mint(order);
  const result = await pay(link.linkId);
  assert.deepEqual([result.status, result.effect, result.reservationId], ['paid', 'voucher-issued', null]);
  assert.deepEqual(calls.map((c) => [c.reservationId, c.ref, c.linkId, c.amountCents]), [[null, String(order.id), link.linkId, 15000]]);
  assert.equal(paymentLinksModel.findById(link.linkId).status, 'paid');
  const [voucher] = vouchers().filter((v) => v.orderId === order.id);
  assert.equal(voucher.amountCents, 15000);
  assert.equal(api.vouchers.find(voucher.id).balanceCents, 15000);
  await api.receipt.idle();
  assert.equal(sent.filter((m) => m.to === 'paul@example.test').length >= 1, true);
});

test('rule 17: a replayed webhook, the poll and the on-demand read all land on the same paid link — one voucher, one effect', async () => {
  liveOwner(api.orderPaid);
  const order = newOrder();
  const link = await mint(order);
  const before = vouchers().length;
  const results = await Promise.all([pay(link.linkId), pay(link.linkId), pay(link.linkId)]);
  assert.equal(results.filter((r) => r.effect === 'voucher-issued').length, 1);
  assert.equal(results.filter((r) => r.effect === 'already-processed').length, 2);
  assert.equal(vouchers().length, before + 1);
  assert.equal(applyPaidEffect({ database: db, link: paymentLinksModel.findById(link.linkId) }).effect, 'voucher-already-issued', 'even the effect run again by hand issues nothing');
  assert.equal(vouchers().length, before + 1);
});

test('rule 17: the browser’s return reads the bank — an unpaid link issues nothing, a paid one issues it, once', async () => {
  liveOwner(api.orderPaid);
  const order = newOrder();
  const link = await mint(order);
  const before = vouchers().length;
  assert.equal(await sdk.core.payments.refreshBasketLink(link.linkId), 'open');
  assert.equal(vouchers().length, before, 'the visitor coming back proves nothing');
  paidAt.set(`rem-${created.length}`, '2026-11-15T10:06:00Z');
  assert.equal(await sdk.core.payments.refreshBasketLink(link.linkId), 'paid');
  assert.equal(vouchers().length, before + 1);
  assert.equal(await sdk.core.payments.refreshBasketLink(link.linkId), 'paid');
  assert.equal(vouchers().length, before + 1);
});

test('rule 17: two links of one order both paid — the second money is flagged to refund on the link, no second voucher', async () => {
  liveOwner(api.orderPaid);
  const order = newOrder();
  const first = await mint(order);
  const second = paymentLinksModel.create({
    reservationId: null, type: 'complement', amountCents: 15000, provider: 'qonto', providerLinkId: 'rem-twin', url: 'https://pay.example.test/twin', status: 'open',
    expiresAt: new Date(Date.now() + 3600000).toISOString(), basket: { source: SOURCE, ref: String(order.id) }, saleRef: `${SOURCE}:${order.id}`,
  });
  paymentLinksModel.markPaid(first.linkId, { providerPaymentId: 'a', paidAt: '2026-11-15T10:05:00Z' });
  const before = vouchers().length;
  const one = applyPaidEffect({ database: db, link: paymentLinksModel.findById(first.linkId) });
  assert.equal(one.effect, 'voucher-issued');
  paymentLinksModel.markPaid(second.id, { providerPaymentId: 'b', paidAt: '2026-11-15T10:06:00Z' });
  const two = applyPaidEffect({ database: db, link: paymentLinksModel.findById(second.id) });
  assert.deepEqual([two.effect, two.reservationId], ['basket-refund-owed', null]);
  assert.equal(vouchers().length, before + 1);
  const basket = JSON.parse(db.prepare('SELECT basketJson FROM payment_links WHERE id = ?').get(second.id).basketJson);
  assert.equal(basket.refundOwed, true);
});

test('rule 17: with the plugin off, a paid link is money the admin sorts out — nothing is issued', async () => {
  liveOwner(api.orderPaid);
  const order = newOrder();
  const link = await mint(order);
  liveOwner(null);
  const before = vouchers().length;
  const notified = [];
  const effect = await processPaidLink({
    database: db, devisModel: {}, paymentLinksModel, link: paymentLinksModel.findById(link.linkId), paidPayment: { paymentId: 'x', paidAt: '2026-11-15T10:05:00Z' },
    notifyPaidAfterCancel: async (l) => { notified.push(l.id); },
  });
  assert.equal(effect.effect, 'basket-unallocated');
  assert.deepEqual(notified, [link.linkId]);
  assert.equal(vouchers().length, before);
  assert.equal(db.prepare("SELECT state FROM gift_voucher_orders WHERE id = ?").get(order.id).state, 'pending');
});

test('rule 17: a link withdrawn then paid anyway is still the plugin’s to settle — the voucher is issued on the late payment', async () => {
  liveOwner(api.orderPaid);
  const order = newOrder();
  const link = await mint(order);
  db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'operator', remoteCancelPendingAt = ? WHERE id = ?").run(new Date().toISOString(), link.linkId);
  paidAt.set(db.prepare('SELECT providerLinkId FROM payment_links WHERE id = ?').get(link.linkId).providerLinkId, '2026-11-15T10:07:00Z');
  const before = vouchers().length;
  const { results } = await retryPendingCancellations({
    database: db, devisModel: {}, paymentLinksModel, provider, notifyPaidAfterCancel: async () => {}, only: link.linkId,
  });
  assert.equal(results.length, 1);
  assert.equal(vouchers().length, before + 1);
});

const mintHour = (order, amountCents = 15000) => sdk.core.payments.saleLink(
  {
    source: SOURCE, ref: order.id, title: `Bon cadeau de ${amountCents / 100} €`, amountCents, validityMinutes: 60,
  },
  { redirectUrl: `https://site.example.test/bon?gf_voucher=${order.id}` },
);
const providerIdOf = (linkId) => db.prepare('SELECT providerLinkId FROM payment_links WHERE id = ?').get(linkId).providerLinkId;
const lapse = (linkId) => {
  db.prepare('UPDATE payment_links SET expiresAt = ? WHERE id = ?').run(new Date(Date.now() - 60 * 1000).toISOString(), linkId);
  return retireLapsedAndWithdrawn(db, { now: new Date() });
};

test('rule 16 (one hour): a sale states its own link life — 60 minutes, handed back until it lapses, and never longer than a day', async () => {
  liveOwner(api.orderPaid);
  const order = newOrder();
  const first = await mintHour(order);
  const minutes = (Date.parse(paymentLinksModel.findById(first.linkId).expiresAt) - Date.now()) / 60000;
  assert.ok(minutes > 59 && minutes <= 60, `${minutes} minutes`);
  db.prepare('UPDATE payment_links SET expiresAt = ? WHERE id = ?').run(new Date(Date.now() + 2 * 60 * 1000).toISOString(), first.linkId);
  const again = await mintHour(order);
  assert.deepEqual([again.linkId, again.reused], [first.linkId, true], 'two minutes from its end the same link is still the buyer’s: the hour is a hard bound, not a rolling one');
  for (const validityMinutes of [0, 1441, 1.5, '60', -5]) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(sdk.core.payments.saleLink({ source: SOURCE, ref: order.id, title: 'x', amountCents: 100, validityMinutes }), (e) => e.error === 'BASKET_REQUIRED');
  }
});

test('rule 16 (one hour): past the hour the link is lapsed by the lifecycle pass and deactivated at the provider by the poll — nothing is issued, the order stays', async () => {
  liveOwner(api.orderPaid);
  const order = newOrder();
  const link = await mintHour(order);
  assert.equal(lapse(link.linkId).some((l) => l.id === link.linkId), true);
  assert.equal(paymentLinksModel.findById(link.linkId).status, 'expired');
  assert.equal(await sdk.core.payments.refreshBasketLink(link.linkId), 'expired');
  const before = cancelled.length;
  await retryPendingCancellations({
    database: db, devisModel: {}, paymentLinksModel, provider, notifyPaidAfterCancel: async () => {}, only: link.linkId,
  });
  assert.deepEqual(cancelled.slice(before), [providerIdOf(link.linkId)], 'the link is withdrawn at the provider');
  assert.equal(paymentLinksModel.findById(link.linkId).remoteCancelPendingAt, null, 'nothing left to deactivate');
  assert.equal(vouchers().filter((v) => v.orderId === order.id).length, 0);
  assert.equal(api.orders.find(order.id).state, 'pending', 'the order is kept (and purged after 7 days)');
});

test('rule 16 (one hour): an on-demand read of a sale link past its end lapses it on the spot; before its end it stays open', async () => {
  liveOwner(api.orderPaid);
  const order = newOrder();
  const link = await mintHour(order);
  assert.equal(await sdk.core.payments.refreshBasketLink(link.linkId), 'open');
  db.prepare('UPDATE payment_links SET expiresAt = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), link.linkId);
  assert.equal(await sdk.core.payments.refreshBasketLink(link.linkId), 'expired');
  assert.ok(paymentLinksModel.findById(link.linkId).remoteCancelPendingAt, 'its deactivation is owed to the poll');
});

test('rule 45: paid at 59 minutes, confirmed at 61 — the link was withdrawn meanwhile and the voucher is issued all the same, never flagged to refund', async () => {
  liveOwner(api.orderPaid);
  const order = newOrder();
  const link = await mintHour(order);
  lapse(link.linkId);
  paidAt.set(providerIdOf(link.linkId), '2026-11-15T10:59:00Z');
  const before = vouchers().length;
  const { results } = await retryPendingCancellations({
    database: db, devisModel: {}, paymentLinksModel, provider, notifyPaidAfterCancel: async () => {}, only: link.linkId,
  });
  assert.equal(results.length, 1);
  assert.equal(vouchers().length, before + 1);
  assert.equal(api.orders.find(order.id).state, 'issued');
  assert.equal(paymentLinksModel.findById(link.linkId).status, 'paid');
  assert.equal(/refundOwed/.test(db.prepare('SELECT basketJson FROM payment_links WHERE id = ?').get(link.linkId).basketJson || ''), false);
  const status = await api.orderPaid({ ref: String(order.id), linkId: link.linkId, amountCents: 15000 });
  assert.equal(status.effect, 'voucher-already-issued', 'a replay issues nothing more');
});

test('SDK 2.32.0: a sale of the standalone-sale family still settles on its own document — only another source goes to a plugin', () => {
  liveOwner(api.orderPaid);
  const sale = paymentLinksModel.create({
    reservationId: null, type: 'complement', amountCents: 900, provider: 'qonto', providerLinkId: 'rem-x', url: 'https://pay.example.test/x', status: 'open',
    expiresAt: new Date(Date.now() + 3600000).toISOString(), basket: { source: 'standalone-sale', ref: 'standalone:9' }, saleRef: 'standalone:9',
  });
  assert.equal(applyPaidEffect({ database: db, link: paymentLinksModel.findById(sale.id) }).effect, 'no-reservation', 'no such document: the standalone path answered, no plugin was called');
});

test('SDK 2.32.0: nothing the core gained for a sale with no stay names the plugin that uses it', () => {
  const fs = require('fs');
  const path = require('path');
  ['utils/basketPayments.js', 'utils/paymentRequestService.js', 'controllers/paymentsController.js', 'plugins/sdk/coreServices.js', 'plugins/sdk/createContext.js'].forEach((file) => {
    assert.equal(/voucher|bon cadeau/i.test(fs.readFileSync(path.join(__dirname, '..', file), 'utf8')), false, file);
  });
});

