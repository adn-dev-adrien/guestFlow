// specs/outside-booking-sas.md rules 28, 29, 33 and specs/pricing-components.md rules 51, 61, 62 — the VAT of a sale with no stay: the external context, one rounding
// per (class, rate) group of the document, the rate frozen on the line at sale, franchise mode, and none of the stay's figures (no tourist tax, no nights, no schedule).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const standaloneSale = require('../utils/standaloneSale');
const sales = require('../models/standaloneSalesModel');
const { externalSale } = require('../utils/pricing/pipelines');

const option = (title, price, vatClass) => Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, 'per_stay', 1, ?)").run(title, price, vatClass).lastInsertRowid);
const beer = option('Bière', 6.5, 'drinks');
const stout = option('Stout', 7.1, 'drinks');
const plank = option('Planche', 14, 'catering');
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);
const line = (id, quantity) => ({ articleRef: `option:${id}`, quantity });

test('rule 28 — every line is cut at the external rate of its class; the VAT is rounded once per (class, rate) group and shared over its lines', () => {
  const { document } = standaloneSale.sell({ lines: [line(beer, 3), line(stout, 3), line(plank, 1)] });
  assert.deepEqual(document.vatByRate, [{ rate: 10, vatCents: 127 }, { rate: 20, vatCents: 1 * Math.round(((1950 + 2130) * 20) / 120) }]);
  const drinks = document.lines.filter((l) => l.vatClass === 'drinks');
  assert.equal(drinks.reduce((sum, l) => sum + l.vatCents, 0), 680, 'the group VAT is shared exactly, never per article');
});

test('rule 29 — the rate is frozen on the line at sale: a rate change before the payment moves nothing', () => {
  const { document } = standaloneSale.sell({ lines: [line(beer, 1)] });
  sales.setExternalRate('drinks', 10);
  const paid = standaloneSale.pay(document.document.id, { tenders: [{ method: 'card', amountCents: 650 }] });
  assert.deepEqual(paid.document.lines.map((l) => [l.vatRate, l.vatCents]), [[20, 108]]);
  const next = standaloneSale.sell({ lines: [line(beer, 1)], saleId: document.document.id, version: paid.document.document.version });
  assert.deepEqual(next.document.lines.map((l) => [l.vatRate, l.vatCents]), [[20, 108], [10, 59]], 'a new line is cut at the rate in force, the old one keeps its own');
  sales.setExternalRate('drinks', 20);
});

test('rule 28 — franchise mode: no VAT, whatever the class rate', () => {
  db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis) VALUES ('not_subject', 0, 'art_293_b', 'all')").run();
  const { document } = standaloneSale.sell({ lines: [line(beer, 2)] });
  assert.deepEqual(document.vatByRate.map((r) => r.vatCents), [0]);
  assert.deepEqual(document.lines.map((l) => [l.vatRate, l.vatCents]), [[0, 0]]);
  db.prepare('DELETE FROM vat_periods').run();
});

test('rule 33 — an external sale calls no stay step: no nights, no tourist tax, no schedule, no clock', () => {
  assert.deepEqual([...externalSale.steps].filter((id) => /night|tax|schedule|clock|platform|midStay/i.test(id)), []);
  const quote = standaloneSale.quote({ lines: [line(beer, 1)] });
  assert.deepEqual(Object.keys(quote.document.totals).sort(), ['paidCents', 'refundOwedCents', 'remainingCents', 'totalCents']);
});
