// specs/outside-booking-sas.md rule 50 (stabilisation loop t4, apps note, 2026-11-16) — a surplus kept at 00:30 in Paris is a tip of that Paris day: the
// row closes at the application's clock (never SQLite's), so the day the journal books it and the day its kept allocation carries agree at any hour.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const standaloneSale = require('../utils/standaloneSale');
const links = require('../utils/standaloneSaleLinks');
const sales = require('../models/standaloneSalesModel');
const payments = require('../models/standalonePaymentsModel');

const beer = Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES ('Bière de minuit', 6.5, 'per_stay', 1, 'drinks')").run().lastInsertRowid);
sales.setExternalRate('drinks', 20);

function atParis(iso, fn) {
  const Real = Date;
  const fixed = new Real(iso).getTime();
  class Fixed extends Real { constructor(...a) { if (a.length === 0) super(fixed); else super(...a); } static now() { return fixed; } }
  global.Date = Fixed;
  try { return fn(); } finally { global.Date = Real; }
}

test('rule 50 — a surplus kept at 00:30 Paris is booked on that Paris day', () => {
  const id = standaloneSale.sell({ lines: [{ articleRef: `option:${beer}`, quantity: 2 }] }).document.document.id;
  standaloneSale.pay(id, { tenders: [{ method: 'cash', amountCents: 1300 }] });
  const link = Number(db.prepare("INSERT INTO payment_links (reservationId, saleRef, type, amountCents, status) VALUES (NULL, ?, 'complement', 1300, 'paid')").run(sales.documentRef(id)).lastInsertRowid);
  links.settlePaidLink({ link: { id: link, saleRef: sales.documentRef(id), amountCents: 1300 }, paidDate: '2026-03-01' });
  const [row] = sales.obligationsOf(id);
  atParis('2026-03-10T00:30:00+01:00', () => assert.equal(links.closeObligation(id, row.id, 'cancelled', { actor: 'admin' }).status, 200));
  const [doc] = payments.documentsPaidBetween('2026-03-10', '2026-03-10').filter((d) => d.sale.id === id);
  assert.ok(doc, 'the kept surplus is a movement of 2026-03-10');
  assert.deepEqual(doc.kept.map((k) => [k.amountCents, k.day]), [[1300, '2026-03-10']]);
});
