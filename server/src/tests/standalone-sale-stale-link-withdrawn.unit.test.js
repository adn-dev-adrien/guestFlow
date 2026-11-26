// specs/sas/outside-booking-sas.md rules 15, 40, 41 (end review R2-4, R3-2) — any change of a document's reste (a counter payment, a line offered,
// removed or added) withdraws its now-stale open link in the same transaction, so it can never be paid; a link paid anyway is booked in full and
// its surplus becomes a durable obligation row the administrator finds on the document, once per link.
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
const { runPaymentPoll } = require('../utils/paymentPollRunner');

const option = (title, price, vatClass) => Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, 'per_stay', 1, ?)").run(title, price, vatClass).lastInsertRowid);
const beer = option('Bière', 6.5, 'drinks');
const plank = option('Planche', 14, 'catering');
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);
const line = (id, quantity) => ({ articleRef: `option:${id}`, quantity });

const created = [];
const paid = new Map();
const fake = {
  id: 'qonto', label: 'Qonto', errorCode: 'QONTO_API_ERROR',
  isReady: () => true,
  createLink: async (args) => { created.push(args); return { id: `rem-${created.length}`, url: `https://pay.example/${created.length}`, status: 'open' }; },
  getPayment: async (id) => (paid.has(id) ? { paid: true, paymentId: `pay-${id}`, paidAt: paid.get(id) } : { paid: false }),
  getLinkStatus: async () => 'open',
  cancelLink: async () => {},
};
registry.configure({ isActive: () => true, allows: () => true });
createContext('online-payment', {}).paymentProvider(fake);

const sell = (lines) => standaloneSale.sell({ lines, customer: { email: 'client@exemple.fr' } }).document;
const poll = () => runPaymentPoll({ database: db, paymentLinksModel, provider: fake, force: true, now: new Date(), notifyPaidAfterCancel: async () => {} });
const linkRow = (id) => paymentLinksModel.findById(id);

test('rule 40 — the counter collecting the reste withdraws the open link; paid anyway, the surplus is an obligation row, once', async () => {
  const doc = sell([line(beer, 2), line(plank, 1)]);
  const id = doc.document.id;
  const minted = await links.mint(id);
  assert.equal(minted.link.amountCents, 2700);
  const cash = standaloneSale.pay(id, { tenders: [{ method: 'cash', amountCents: 2700 }] });
  assert.equal(cash.document.totals.remainingCents, 0);
  assert.deepEqual([linkRow(minted.link.id).status, linkRow(minted.link.id).cancelReason], ['cancelled', 'amount-changed']);
  assert.equal(links.linkOf(id).open, null, 'no open link left to pay');
  paid.set(linkRow(minted.link.id).providerLinkId, new Date().toISOString());
  await poll();
  await poll();
  const after = standaloneSale.documentOf(id);
  assert.equal(after.totals.refundOwedCents, 2700);
  assert.deepEqual(after.refundObligations.map((row) => [row.origin, row.paymentLinkId, row.amountCents]), [['linkSurplus', minted.link.id, 2700]]);
});

test('rule 40 — offering, removing or adding a line withdraws the open link; a payment that leaves the reste where it was keeps it', async () => {
  const doc = sell([line(beer, 2), line(plank, 1)]);
  const id = doc.document.id;
  let minted = await links.mint(id);
  standaloneSale.offerLine(id, doc.lines[1].id, { offered: true });
  assert.equal(linkRow(minted.link.id).status, 'cancelled', 'offered');
  minted = await links.mint(id);
  standaloneSale.removeLine(id, doc.lines[0].id, {});
  assert.equal(linkRow(minted.link.id).status, 'cancelled', 'removed');
  const fresh = sell([line(beer, 1)]);
  minted = await links.mint(fresh.document.id);
  standaloneSale.sell({ saleId: fresh.document.id, lines: [line(plank, 1)] });
  assert.equal(linkRow(minted.link.id).status, 'cancelled', 'a line added to the document');
  const kept = sell([line(beer, 1)]);
  minted = await links.mint(kept.document.id);
  standaloneSale.offerLine(kept.document.id, kept.lines[0].id, { offered: false });
  assert.equal(linkRow(minted.link.id).status, 'open', 'the reste did not move: the link stays');
});
