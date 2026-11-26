// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rule 32 (stabilisation loop t10 D10-2, 2026-11-17) — the payment link of a sale
// outside a stay (outside-booking-sas rules 39-42: a `complement` link with `saleRef`, no stay) is a Mollie payment like any link: once paid,
// its split is the sale day's two tranches (`sale:<sale key>:link-<id>`, reservation id 0), its Mollie credits can be matched and confirmed,
// the journal books its « link » entry on the payment day under the sale, and « Versements à venir » lists its tranches. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../../sdk/registry');
const { db, dayAt, build, reset, mollieCredit } = require('./mollieFixture');
const standaloneSale = require('../../../utils/standaloneSale');
const saleLinks = require('../../../utils/standaloneSaleLinks');
const sales = require('../../../models/standaloneSalesModel');

const option = Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES ('Panier fermier', 45, 'per_stay', 1, 'drinks')").run().lastInsertRowid);
sales.setExternalRate('drinks', 20);

function clearSales() {
  db.prepare("DELETE FROM payment_allocations WHERE documentRef LIKE 'standalone:%'").run();
  ['standalone_sale_obligations', 'standalone_sale_history', 'standalone_sale_payments', 'standalone_sale_lines', 'standalone_sales'].forEach((t) => db.prepare(`DELETE FROM ${t}`).run());
  db.prepare('DELETE FROM payment_links WHERE saleRef IS NOT NULL').run();
}

test.beforeEach(() => { reset(); clearSales(); registry.reset(); registry.configure({ isActive: () => true, allows: () => true }); });
test.afterEach(() => { registry.reset(); });

const itemsOf = (controller) => ['todo', 'waiting', 'done'].flatMap((view) => controller.list({ view }).body.items);

/** A sale of 45 € paid whole by its payment link `daysAgo` days ago (Paris noon). */
function saleByLink(daysAgo) {
  const saleId = standaloneSale.sell({ lines: [{ articleRef: `option:${option}`, quantity: 1 }], customerName: 'Exemple' }).document.document.id;
  const paidDay = dayAt(-daysAgo);
  const linkId = Number(db.prepare(`INSERT INTO payment_links (reservationId, saleRef, type, provider, providerLinkId, url, amountCents, currency, status, createdAt, basketJson, paidAt, providerPaymentId)
    VALUES (NULL, ?, 'complement', 'qonto', ?, 'u', 4500, 'EUR', 'paid', datetime('now'), ?, ?, ?)`)
    .run(sales.documentRef(saleId), `LS${saleId}`, JSON.stringify({ source: 'standalone-sale', ref: sales.documentRef(saleId) }), `${paidDay}T10:00:00Z`, `pay-s${saleId}`).lastInsertRowid);
  const link = db.prepare('SELECT * FROM payment_links WHERE id = ?').get(linkId);
  assert.equal(saleLinks.settlePaidLink({ link, paidDate: paidDay }).effect, 'standalone-sale-settled');
  return { saleId, linkId, paidDay, key: `sale:standalone:${saleId}:${paidDay}:link-${linkId}` };
}

test('rule 32 — a paid sale link is split once, with no stay, under the sale day it paid', () => {
  const { linkId, key } = saleByLink(6);
  build({ startDate: dayAt(-60) });
  const split = db.prepare("SELECT reservationId, ledgerKey, grossCents, immediateCents, reserveCents FROM mollie_payment_splits WHERE sourceType = 'link' AND sourceKey = ?").get(String(linkId));
  assert.deepEqual(split, { reservationId: null, ledgerKey: key, grossCents: 4500, immediateCents: 3600, reserveCents: 900 });
});

test('rule 32 — the sale link yields two receipts (36 € now, 9 € held), named by the sale, never by a stay', () => {
  const { linkId, key, saleId } = saleByLink(6);
  const { controller } = build({ startDate: dayAt(-60) });
  const tranches = itemsOf(controller).filter((i) => i.mollie && i.mollie.splitId === `link:${linkId}`);
  assert.deepEqual(tranches.map((i) => [i.ledgerKey, i.expectedCents]).sort(), [[`${key}#immediat`, 3600], [`${key}#retenue`, 900]]);
  tranches.forEach((i) => {
    assert.equal(i.reservation.id, null);
    assert.equal(i.reservation.saleKey, `standalone:${saleId}:${dayAt(-6)}`);
  });
});

test('rule 32 — its Mollie credit is proposed on the immediate tranche and confirmed under reservation id 0', () => {
  const { key } = saleByLink(6);
  const { controller, transactions } = build({ startDate: dayAt(-60) });
  transactions.upsertMany([mollieCredit('c1', 3600, 2, { reference: 'REF T19274230.2611.41' })], { bankAccountId: 'acc-1' });
  const immediate = itemsOf(controller).find((i) => i.ledgerKey === `${key}#immediat`);
  assert.ok(immediate.proposal, 'the 36 € credit is proposed on the sale link\'s immediate tranche');
  const answer = controller.confirm({ transactionId: 'c1', allocations: [{ reservationId: 0, ledgerKey: `${key}#immediat`, amountCents: 3600 }], user: { id: 1 } });
  assert.ok(answer.status < 300, `confirmed (${answer.status})`);
  assert.deepEqual(db.prepare('SELECT reservationId, ledgerKey, amountCents FROM bank_reconciliation_lines').all(), [{ reservationId: 0, ledgerKey: `${key}#immediat`, amountCents: 3600 }]);
});

test('rule 32 — the journal books the sale link on its payment day (clearing debited, the sale\'s client settled)', () => {
  const { saleId, paidDay } = saleByLink(6);
  const { controller } = build({ startDate: dayAt(-60) });
  const entries = controller.journal({ from: paidDay, to: paidDay }).entries.filter((e) => e.kind === 'link');
  assert.deepEqual(entries.map((e) => [e.amountCents, e.saleKey, e.reservationId]), [[4500, `standalone:${saleId}:${paidDay}`, null]]);
});

test('rule 32 — « Versements à venir » lists the two tranches of the sale link', () => {
  const { saleId, paidDay } = saleByLink(6);
  const { controller } = build({ startDate: dayAt(-60) });
  const items = controller.incomingItems().filter((i) => i.sale && i.sale.key === `standalone:${saleId}:${paidDay}`);
  assert.deepEqual(items.map((i) => [i.kind, i.amountCents]).sort(), [['mollieReserve', 900], ['mollieTransit', 3600]]);
  items.forEach((i) => assert.equal(i.reservationId, null));
});

test('rule 32 — a paid sale link whose payment no sale day lists yet still yields its tranches, named « Vente hors séjour »', () => {
  const paidDay = dayAt(-4);
  const linkId = Number(db.prepare(`INSERT INTO payment_links (reservationId, saleRef, type, provider, providerLinkId, url, amountCents, currency, status, createdAt, paidAt, providerPaymentId)
    VALUES (NULL, 'standalone:999', 'complement', 'qonto', 'LS999', 'u', 2000, 'EUR', 'paid', datetime('now'), ?, 'pay-s999')`).run(`${paidDay}T10:00:00Z`).lastInsertRowid);
  const { controller } = build({ startDate: dayAt(-60) });
  const key = `sale:standalone:999:${paidDay}:link-${linkId}`;
  const tranches = itemsOf(controller).filter((i) => i.mollie && i.mollie.splitId === `link:${linkId}`);
  assert.deepEqual(tranches.map((i) => [i.ledgerKey, i.expectedCents, i.reservation.saleLabel]).sort(), [
    [`${key}#immediat`, 1600, 'Vente hors séjour'], [`${key}#retenue`, 400, 'Vente hors séjour'],
  ]);
});
