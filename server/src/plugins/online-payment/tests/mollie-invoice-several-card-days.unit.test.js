// specs/mollie-rolling-reserve-and-incoming-payments.md rule 33 (stabilisation loop t10 D10-1, 2026-11-17) — a sale outside a stay with ONE Qonto
// invoice, paid by card on two days (30 € then 50 €), is two Mollie payments: two splits, two pairs of tranches. The invoice number keys the first
// card day only (the payment a Mollie `description` can name); the later day is a card tender of its own. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../../sdk/registry');
const { db, dayAt, build, reset } = require('./mollieFixture');
const standaloneSale = require('../../../utils/standaloneSale');
const sales = require('../../../models/standaloneSalesModel');
const { invoiceSources, cardCandidates } = require('../reconciliation/mollieCardSources');

const option = Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES ('Location vélo', 40, 'per_stay', 1, 'drinks')").run().lastInsertRowid);
sales.setExternalRate('drinks', 20);
const NUMBER = 'F-2026-T10';

function clearSales() {
  db.prepare("DELETE FROM payment_allocations WHERE documentRef LIKE 'standalone:%'").run();
  ['standalone_sale_obligations', 'standalone_sale_history', 'standalone_sale_payments', 'standalone_sale_lines', 'standalone_sales'].forEach((t) => db.prepare(`DELETE FROM ${t}`).run());
}

test.beforeEach(() => { reset(); clearSales(); registry.reset(); registry.configure({ isActive: () => true, allows: () => true }); });
test.afterEach(() => { registry.reset(); });

/** 80 € sold with one invoice, paid by card 30 € ten days ago and 50 € five days ago. */
function twoCardDays() {
  const saleId = standaloneSale.sell({ lines: [{ articleRef: `option:${option}`, quantity: 2 }], customerName: 'Exemple' }).document.document.id;
  db.prepare('UPDATE standalone_sales SET invoiceNumber = ? WHERE id = ?').run(NUMBER, saleId);
  assert.equal(standaloneSale.pay(saleId, { tenders: [{ method: 'card', amountCents: 3000 }], shortfall: { kind: 'due' }, paidAt: dayAt(-10) }).status, 200);
  assert.equal(standaloneSale.pay(saleId, { tenders: [{ method: 'card', amountCents: 5000 }], paidAt: dayAt(-5) }).status, 200);
  return { saleId, first: `standalone:${saleId}:${dayAt(-10)}`, second: `standalone:${saleId}:${dayAt(-5)}` };
}

const SETTINGS = { mollieCardOnSiteSince: dayAt(-30) };

test('rule 33 — two card days of one invoice are two candidates with two keys, the number on the first day only', () => {
  const { first, second } = twoCardDays();
  const found = cardCandidates({ rows: [], linksOf: () => [], installmentsOf: () => [], settlementsOf: () => [], startDate: dayAt(-60), today: dayAt(0) });
  assert.deepEqual(found.map((c) => [c.sourceType, c.sourceKey, c.ledgerKey, c.grossCents, c.paidAt]), [
    ['invoice', NUMBER, `sale:${first}`, 3000, dayAt(-10)],
    ['tender', `sale:${second}`, `sale:${second}`, 5000, dayAt(-5)],
  ]);
});

test('rule 33 — the sync stores two splits (30 € and 50 €), and stores them again unchanged', () => {
  const { first, second } = twoCardDays();
  const { controller } = build({ startDate: dayAt(-60), settings: SETTINGS });
  const read = () => db.prepare('SELECT sourceType, sourceKey, ledgerKey, grossCents, immediateCents, reserveCents FROM mollie_payment_splits ORDER BY paidAt').all();
  const expected = [
    { sourceType: 'invoice', sourceKey: NUMBER, ledgerKey: `sale:${first}`, grossCents: 3000, immediateCents: 2400, reserveCents: 600 },
    { sourceType: 'tender', sourceKey: `sale:${second}`, ledgerKey: `sale:${second}`, grossCents: 5000, immediateCents: 4000, reserveCents: 1000 },
  ];
  assert.deepEqual(read(), expected);
  controller.syncSplits();
  assert.deepEqual(read(), expected, 'idempotent');
});

test('rule 33 — the receipts are four tranches, 24 + 6 under the first day and 40 + 10 under the second', () => {
  const { first, second } = twoCardDays();
  const { controller } = build({ startDate: dayAt(-60), settings: SETTINGS });
  const tranches = ['todo', 'waiting', 'done'].flatMap((view) => controller.list({ view }).body.items).filter((i) => i.mollie);
  assert.deepEqual(tranches.map((i) => [i.ledgerKey, i.expectedCents]).sort(), [
    [`sale:${first}#immediat`, 2400], [`sale:${first}#retenue`, 600], [`sale:${second}#immediat`, 4000], [`sale:${second}#retenue`, 1000],
  ].sort());
});

test('rule 33 — a Mollie payment naming the invoice pairs with the first card day, never the last one listed', () => {
  const { first } = twoCardDays();
  const source = invoiceSources(dayAt(0)).get(NUMBER);
  assert.deepEqual(source, { sourceType: 'invoice', sourceKey: NUMBER, reservationId: null, ledgerKey: `sale:${first}` });
});

test('rule 33 — « Versements à venir » expects the whole 80 € paid by card: 24 + 6 and 40 + 10', () => {
  const { saleId } = twoCardDays();
  const { controller } = build({ startDate: dayAt(-60), settings: SETTINGS });
  const items = controller.incomingItems().filter((i) => i.sale && String(i.sale.key).startsWith(`standalone:${saleId}:`));
  assert.deepEqual(items.map((i) => i.amountCents).sort((a, b) => a - b), [600, 1000, 2400, 4000]);
});
