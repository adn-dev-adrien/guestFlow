// specs/pricing-components.md §3 rules 13, 29, 94 (loop t1 S-1, S-2) — a custom line is named by its label: a card sale of one paid before the
// arrival settles it, and a second sale of the same label is a line of its own (its discount, payment and removal never reach the first).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');

const custom = (label, amount) => [{ articleRef: 'custom', label, amount }];
const customLines = (id) => db.prepare('SELECT lineId, description, amount, discountCents, offered FROM reservation_custom_options WHERE reservationId = ? ORDER BY lineId').all(id);

test('S-1 — a custom line sold by card before the arrival is written settled (no « no such column »), and the complement owes nothing for it', () => {
  const id = stay(20);
  const sold = extraSale.sell(id, custom('Bain — supplément soirée', 20), { source: 'shop', orderRef: 'order:1', paid: { amountCents: 2000, ref: '1' } });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.deepEqual([sold.settledCents, sold.overpaidCents], [2000, 0]);
  const line = extraSale.saleDetailOf(id).lines.find((l) => l.label === 'Bain — supplément soirée');
  assert.deepEqual([line.status, line.settledCents], ['paid', 2000]);
  assert.equal(Number(row(id).complementAmount), 0);
});

test('S-2 — two sales of one label are two lines: the second is numbered, its discount and its removal are its own, the paid first stays paid', () => {
  const id = stay(-1);
  const paid = extraSale.sell(id, custom('Bière locale', 5), { payment: 'card-terminal' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const later = extraSale.sell(id, custom('Bière locale', 5), {});
  assert.equal(later.status, 200, JSON.stringify(later.body));
  const [first, second] = customLines(id);
  assert.deepEqual([first.description, second.description], ['Bière locale', 'Bière locale (2)']);
  const detail = extraSale.saleDetailOf(id).lines.filter((l) => l.label.startsWith('Bière locale'));
  assert.deepEqual(detail.map((l) => [l.ref, l.status, l.settledCents]), [[`custom:${first.lineId}`, 'paid', 500], [`custom:${second.lineId}`, 'dueAtDeparture', 0]]);
  const before = Number(row(id).finalPrice);
  const discounted = extraSale.changeLine(id, `custom:${second.lineId}`, { discount: { amount: 2 } });
  assert.equal(discounted.status, 200, JSON.stringify(discounted.body));
  assert.equal(Number(row(id).finalPrice), before - 2, 'the 2 € discount takes 2 €, never the paid line\'s share');
  assert.deepEqual(customLines(id).map((l) => l.discountCents || 0), [0, 200]);
  assert.equal(extraSale.removeLine(id, `custom:${first.lineId}`).body.code, 'LINE_PAID', 'the paid line is not removable');
  assert.equal(extraSale.removeLine(id, `custom:${second.lineId}`).status, 200);
  assert.deepEqual(customLines(id).map((l) => l.description), ['Bière locale']);
});
