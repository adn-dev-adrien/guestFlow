// specs/pricing-components.md §3 rules 16, 39, 40, 58, 59 — the engine applies the target of a stay discount and a line's own
// discount: a `nights` discount is today's formula, `extras` / `all` are shared out over the unpaid lines sold with the stay (rule
// 40), a line discount comes off one line, and a quote without any of them carries no new key on its lines.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const { calculateReservationQuote } = require('../utils/pricing');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const START = addDaysToIsoDate(todayIso(), 150);
const END = addDaysToIsoDate(START, 2);
const propertyId = 9101;
db.prepare("INSERT INTO properties (id, name) VALUES (?, 'Remises')").run(propertyId);
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (?, 'Standard', 100)").run(propertyId);
const insertOption = db.prepare("INSERT INTO options (title, price, priceType) VALUES (?, ?, 'per_stay')");
const optionA = Number(insertOption.run('Option A', 40).lastInsertRowid);
const optionB = Number(insertOption.run('Option B', 60).lastInsertRowid);
for (const id of [optionA, optionB]) db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(propertyId, id);

const quote = (extra = {}) => calculateReservationQuote({
  db, propertyId, startDate: START, endDate: END, adults: 2,
  selectedOptions: [{ optionId: optionA, quantity: 1 }, { optionId: optionB, quantity: 1 }], ...extra,
});
const lineOf = (q, optionId) => q.optionLines.find((l) => l.optionId === optionId);

test('rule 58 — no target typed reads as Nuits: the discount is the accommodation formula, the lines carry no new key', () => {
  const plain = quote({ discountPercent: 10 });
  const nights = quote({ discountPercent: 10, discountTarget: 'nights' });
  assert.deepEqual(nights, plain);
  assert.equal(plain.finalPrice, 180 + 100);
  assert.equal(plain.discountPercent, 10);
  for (const line of plain.optionLines) assert.ok(!('grossTotalPrice' in line) && !('discountCents' in line) && !('stayDiscountShareCents' in line));
});

test('rules 16, 40 — extras: 10 % comes off the unpaid lines, the accommodation is not covered', () => {
  const q = quote({ discountPercent: 10, discountTarget: 'extras' });
  assert.equal(q.totalPrice, 200, 'the accommodation keeps its price');
  assert.equal(q.optionsTotal, 90);
  assert.equal(q.finalPrice, 290);
  assert.equal(q.discountAmount, 10, 'discountAmount counts the extras\' discount');
  assert.equal(q.discountPercent, 10, 'the typed percent is echoed');
  assert.deepEqual([lineOf(q, optionA).totalPrice, lineOf(q, optionA).stayDiscountShareCents, lineOf(q, optionA).grossTotalPrice], [36, 400, 40]);
  assert.deepEqual([lineOf(q, optionB).totalPrice, lineOf(q, optionB).stayDiscountShareCents], [54, 600]);
});

test('rules 16, 40 — all: the accommodation takes its share of the same cents', () => {
  const q = quote({ discountPercent: 10, discountTarget: 'all' });
  assert.equal(q.finalPrice, 300 - 30);
  assert.equal(q.optionsTotal, 90);
  assert.equal(q.discountAmount, 30);
});

test('rule 40 — a fixed amount is capped at what the target holds', () => {
  const q = quote({ discountTarget: 'extras', discountFixedAmount: 500 });
  assert.equal(q.optionsTotal, 0);
  assert.equal(q.finalPrice, 200);
});

test('rule 39 — a line\'s own discount comes off that line only and is a line fact of the stored stay', () => {
  const q = quote({ lineFacts: { [`opt:${optionA}`]: { discountCents: 1000, source: 'fiche', settledCents: 0, soldAt: '', lineId: 1 } } });
  assert.deepEqual([lineOf(q, optionA).totalPrice, lineOf(q, optionA).discountCents, lineOf(q, optionA).grossTotalPrice], [30, 1000, 40]);
  assert.equal(lineOf(q, optionB).totalPrice, 60);
  assert.equal(q.finalPrice, 290);
  const capped = quote({ lineFacts: { [`opt:${optionA}`]: { discountCents: 99999, lineId: 1 } } });
  assert.equal(lineOf(capped, optionA).totalPrice, 0, 'a line never goes below 0');
});

test('rule 59 — a stay discount never covers a paid line, a shop or SAS sale, nor an offered one', () => {
  const facts = {
    [`opt:${optionA}`]: { source: 'shop', settledCents: 0, soldAt: '2026-11-01', lineId: 1 },
    [`opt:${optionB}`]: { source: 'fiche', settledCents: 6000, soldAt: '2026-11-01', lineId: 2 },
  };
  const q = quote({ discountPercent: 50, discountTarget: 'extras', lineFacts: facts });
  assert.equal(q.optionsTotal, 100, 'the shop line and the paid line keep their price');
  assert.equal(q.finalPrice, 300);
});

test('rule 16 — a platform stay keeps its own gross pin: the stay discount does not reach the extras', () => {
  const direct = quote({ discountPercent: 10, discountTarget: 'extras' });
  const platform = quote({ discountPercent: 10, discountTarget: 'extras', platform: 'Booking.com' });
  assert.equal(direct.optionsTotal, 90);
  assert.equal(platform.optionsTotal, 100);
});
