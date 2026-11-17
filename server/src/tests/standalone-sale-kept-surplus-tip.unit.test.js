// specs/outside-booking-sas.md rule 50 (owner decision 2026-11-16, stabilisation loop t1 B-6; completes rules 30, 41) — a link paid above what the document
// still asked and closed « rien à rembourser » is money kept: the journal books it as a tip on the day it was kept, on the plan's tip account, like a stay's
// tip; a surplus refunded books nothing (it never reached the books).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const standaloneSale = require('../utils/standaloneSale');
const links = require('../utils/standaloneSaleLinks');
const sales = require('../models/standaloneSalesModel');
const standaloneSales = require('../utils/standaloneSales');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const { skipWithout } = require('../plugins/sdk/testing');

const NEEDS_PLAN = { skip: skipWithout(['accounting-export']) };
const beer = Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES ('Bière gardée', 6.5, 'per_stay', 1, 'drinks')").run().lastInsertRowid);
sales.setExternalRate('drinks', 20);
const TODAY = todayIso();
const PAID_DAY = addDaysToIsoDate(TODAY, -3);

// 13 € paid in cash at the counter, then a 13 € link paid three days ago anyway: a 13 € surplus on no line.
function surplusSale() {
  const id = standaloneSale.sell({ lines: [{ articleRef: `option:${beer}`, quantity: 2 }] }).document.document.id;
  standaloneSale.pay(id, { tenders: [{ method: 'cash', amountCents: 1300 }] });
  const link = Number(db.prepare("INSERT INTO payment_links (reservationId, saleRef, type, amountCents, status) VALUES (NULL, ?, 'complement', 1300, 'paid')").run(sales.documentRef(id)).lastInsertRowid);
  assert.equal(links.settlePaidLink({ link: { id: link, saleRef: sales.documentRef(id), amountCents: 1300 }, paidDate: PAID_DAY }).effect, 'standalone-sale-refund-owed');
  return id;
}
const tipsOf = (id, from = PAID_DAY, to = TODAY) => standaloneSales.list({ from, to }).filter((sale) => String(sale.key).startsWith(`standalone:${id}:`) && sale.role === 'tip');

test('rule 50 — the surplus kept is a tip of its amount, on the day it was kept; its history says so', () => {
  const id = surplusSale();
  assert.deepEqual(tipsOf(id), [], 'an open surplus is no tip yet');
  const [row] = sales.obligationsOf(id);
  const closed = links.closeObligation(id, row.id, 'cancelled', { actor: 'admin@exemple.fr' });
  assert.equal(closed.status, 200);
  assert.equal(closed.document.history.at(-1).text, '13,00 € gardés en pourboire');
  assert.deepEqual(tipsOf(id).map((sale) => [sale.key, sale.date, sale.booksCents, sale.cardCents, sale.totalCents]), [[`standalone:${id}:${TODAY}:tip:${row.id}`, TODAY, 1300, 0, 0]]);
  assert.deepEqual(tipsOf(id, PAID_DAY, PAID_DAY), [], 'the payment day is not moved');
  assert.equal(standaloneSale.documentOf(id).totals.refundOwedCents, 0);
});

test('rule 50 — the tip books on the plan\'s tip account, no VAT, named « Pourboire »', NEEDS_PLAN, () => {
  const id = surplusSale();
  const [row] = sales.obligationsOf(id);
  links.closeObligation(id, row.id, 'cancelled');
  const { create } = require('../plugins/accounting-export/accountingModel');
  const [year, month] = TODAY.split('-').map(Number);
  const entry = create(db).standaloneSalesByMonth({ month, year }).find((e) => e.standaloneKey === `standalone:${id}:${TODAY}:tip:${row.id}`);
  assert.ok(entry, 'the tip is an entry of the month');
  assert.deepEqual([entry.kind, entry.standaloneRole, entry.encaissementTtc], ['standaloneTip', 'tip', 13]);
  const { create: createJournalLines } = require('../utils/accounting/journalLines');
  const lines = createJournalLines({ accountPlan: require('../plugins/accounting-export/accountPlan') }).entryLines(entry);
  assert.deepEqual(lines.map((l) => [l.role, l.side, l.amountCents, l.account || null]), [['customer', 'debit', 1300, null], ['revenue:tip', 'credit', 1300, entry.tipAccount]]);
  assert.equal(entry.accountLabels[entry.tipAccount], 'Pourboire');
});

test('rule 50 — a surplus refunded books nothing: it never reached the books', () => {
  const id = surplusSale();
  const [row] = sales.obligationsOf(id);
  links.closeObligation(id, row.id, 'settled');
  assert.deepEqual(tipsOf(id), []);
  assert.deepEqual(standaloneSales.list({ from: PAID_DAY, to: TODAY }).filter((sale) => String(sale.key).startsWith(`standalone:${id}:`) && sale.role), []);
});
