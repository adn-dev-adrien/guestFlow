// specs/pricing-components.md §3 rule 72 (owner O-3) — `card` is a means of refund: the guest's card was refunded from the
// provider's space, by hand. GuestFlow calls no refund API; it keeps the provider's reference beside the refund. A card refund
// is book money, like a transfer.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, fiche, pay, S, NO_ACOMPTE, register, refund } = require('./moneyLedgerFixture');
const { judge, validateRefundPayload } = require('../utils/pricing/refunds/judge');
const { classify, SELECTABLE_REFUND_METHODS, totals } = require('../utils/pricing/refunds/register');

test('rule 72 (O-3) — card is selectable, book money, and not off the books', () => {
  assert.ok(SELECTABLE_REFUND_METHODS.includes('card'));
  assert.deepEqual(classify({ method: 'card' }), { kind: 'refund', book: true, offBooks: false });
  const read = totals([{ method: 'card', totalTtc: 40, lines: [] }], { scope: 'given' });
  assert.deepEqual([read.bookCents, read.withCashCents], [4000, 4000]);
});

test('rule 72 (O-3) — the judge keeps the provider reference of a card refund, trimmed, and none for another means', () => {
  const lines = [{ label: 'Geste', bucket: 'accommodation', amountTtc: 10 }];
  const base = { refundableLines: [], today: '2026-08-20', liveCollectedTtc: 100, finalPrice: 100, touristTaxTotal: 0 };
  const card = judge({ refundDate: '2026-08-20', method: 'card', providerRefundRef: '  re_123  ', lines }, base, { today: '2026-08-20' });
  assert.equal(card.refund.providerRefundRef, 're_123');
  const bare = judge({ refundDate: '2026-08-20', method: 'card', lines }, base, { today: '2026-08-20' });
  assert.equal(bare.refund.providerRefundRef, null);
  const transfer = validateRefundPayload({ refundDate: '2026-08-20', method: 'transfer', providerRefundRef: 'x', lines }, base);
  assert.equal('providerRefundRef' in transfer.refund, false);
});

test('rule 72 (O-3) — a card refund through the register is stored with its reference and a negative allocation on the books', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  pay(id, S);
  const line = register(id).refundableLines.find((l) => l.refundableTtc > 2);
  const res = refund(id, [{ key: line.key, amountTtc: 2 }], 'card', { providerRefundRef: 're_77' });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  const stored = db.prepare('SELECT method, kind, providerRefundRef, amountCents FROM reservation_refunds WHERE id = ?').get(res.body.refund.id);
  assert.deepEqual(stored, { method: 'card', kind: 'refund', providerRefundRef: 're_77', amountCents: 200 });
  const allocation = db.prepare("SELECT amountCents, books FROM payment_allocations WHERE documentRef = ? AND kind = 'refund'").get(`reservation:${id}`);
  assert.deepEqual(allocation, { amountCents: -200, books: 1 });
  const unknown = refund(id, [{ key: line.key, amountTtc: 1 }], 'bitcoin');
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.body.code, 'REFUND_INVALID_METHOD');
});
