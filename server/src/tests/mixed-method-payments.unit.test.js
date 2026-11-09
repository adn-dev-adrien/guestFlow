// specs/mixed-method-payments.md — the pure rules of a payment split over several methods: what a set of lines
// may be (rules 4-9, 15) and what a recorded settlement counts for (rules 16-18, 26-28).
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  METHODS, validateSettlement, settlementFigures, targetFigures, reservationAggregates, settlementText,
} = require('../utils/paymentTenders');

const cash = (amountCents, internal = true) => ({ method: 'cash', amountCents, internal });
const card = (amountCents) => ({ method: 'card', amountCents });

// ── validateSettlement ──────────────────────────────────────────────────────────────────────────

test('rule 4 — six methods, in display order, labelled by the server', () => {
  assert.deepEqual(METHODS.map((m) => m.label), ['CB', 'Espèces', 'Chèque', 'Virement', 'Chèques-vacances', 'Autre']);
});

test('rule 6 — the lines covering the amount due settle it', () => {
  const v = validateSettlement({ tenders: [cash(5000), card(7200)], dueCents: 12200 });
  assert.equal(v.ok, true);
  assert.equal(v.receivedCents, 12200);
  assert.equal(v.shortfallCents, 0);
  assert.equal(v.shortfallKind, null);
});

test('rule 6 — over the amount due is refused, naming both figures', () => {
  const v = validateSettlement({ tenders: [cash(5000), card(8000)], dueCents: 12200 });
  assert.equal(v.ok, false);
  assert.equal(v.field, 'tenders');
  assert.match(v.error, /130,00 €.*122,00 €/);
});

test('rule 15 — under the amount due without a choice is refused on the shortfall', () => {
  const v = validateSettlement({ tenders: [cash(5000), card(6400)], dueCents: 12200 });
  assert.equal(v.ok, false);
  assert.equal(v.field, 'shortfall');
  assert.match(v.error, /8,00 €/);
});

test('rule 15 — under the amount due with a choice keeps the shortfall and its kind', () => {
  for (const kind of ['due', 'waived']) {
    const v = validateSettlement({ tenders: [cash(5000), card(6400)], dueCents: 12200, shortfall: { kind } });
    assert.equal(v.ok, true);
    assert.equal(v.shortfallCents, 800);
    assert.equal(v.shortfallKind, kind);
  }
});

test('rule 15 — an unknown shortfall kind is no choice', () => {
  const v = validateSettlement({ tenders: [card(100)], dueCents: 200, shortfall: { kind: 'later' } });
  assert.equal(v.field, 'shortfall');
});

test('rules 1, 6 — one line is enough; five are refused', () => {
  assert.equal(validateSettlement({ tenders: [{ method: 'cheque', amountCents: 12200 }], dueCents: 12200 }).ok, true);
  const five = [card(1), cash(1), { method: 'cheque', amountCents: 1 }, { method: 'transfer', amountCents: 1 }, { method: 'other', amountCents: 1 }];
  assert.equal(validateSettlement({ tenders: five, dueCents: 5 }).ok, false);
  assert.equal(validateSettlement({ tenders: [], dueCents: 5 }).ok, false);
});

test('rule 8 — two lines with the same method and destination are refused', () => {
  const v = validateSettlement({ tenders: [card(100), card(100)], dueCents: 200 });
  assert.equal(v.error, 'Une seule ligne CB.');
  const both = validateSettlement({ tenders: [cash(100, true), cash(100, false)], dueCents: 200 });
  assert.equal(both.ok, true, 'cash in the caisse and cash on the books are two destinations');
  assert.equal(validateSettlement({ tenders: [cash(100), cash(100)], dueCents: 200 }).error, 'Une seule ligne Espèces en caisse interne.');
});

test('rule 5 — only cash goes to the caisse interne', () => {
  const v = validateSettlement({ tenders: [{ method: 'card', amountCents: 200, internal: true }], dueCents: 200 });
  assert.equal(v.ok, false);
  assert.match(v.error, /espèces/i);
});

test('rule 6 — every line is positive, in cents, with a known method', () => {
  assert.equal(validateSettlement({ tenders: [card(0)], dueCents: 200 }).ok, false);
  assert.equal(validateSettlement({ tenders: [card(-5)], dueCents: 200 }).ok, false);
  assert.equal(validateSettlement({ tenders: [{ method: 'bitcoin', amountCents: 200 }], dueCents: 200 }).ok, false);
  assert.equal(validateSettlement({ tenders: [card(200)], dueCents: 0 }).ok, false);
  assert.equal(validateSettlement({ tenders: [card(199.6)], dueCents: 200 }).ok, true, 'rounded to the cent');
});

// ── What a settlement counts for ─────────────────────────────────────────────────────────────────

const today = { id: 1, tenders: [{ method: 'cash', amountCents: 5000, internal: 1 }, { method: 'card', amountCents: 7200, internal: 0 }], shortfallCents: 0, shortfallKind: null };

test('rules 26-28 — the day\'s cleaning: 72 € on the books and at the bank, 50 € in the caisse', () => {
  const f = settlementFigures(today);
  assert.deepEqual(
    { received: f.receivedCents, books: f.booksCents, internal: f.internalCents, bank: f.bankCents },
    { received: 12200, books: 7200, internal: 5000, bank: 7200 },
  );
});

test('rule 28 — only card, cheque and transfer are expected at the bank', () => {
  const f = settlementFigures({ tenders: [
    { method: 'cash', amountCents: 100, internal: 0 }, { method: 'holidayVoucher', amountCents: 200, internal: 0 },
    { method: 'other', amountCents: 300, internal: 0 }, { method: 'cheque', amountCents: 400, internal: 0 },
    { method: 'transfer', amountCents: 500, internal: 0 },
  ] });
  assert.equal(f.bankCents, 900);
  assert.equal(f.booksCents, 1500);
});

test('rule 18 — the books carry the geste commercial in proportion of the lines on the books', () => {
  const f = settlementFigures({ tenders: [{ method: 'cash', amountCents: 5000, internal: 1 }, { method: 'card', amountCents: 6400, internal: 0 }], shortfallCents: 800, shortfallKind: 'waived' });
  assert.equal(f.waivedCents, 800);
  assert.equal(f.bookedWaivedCents, Math.round(800 * 6400 / 11400));
  const allCaisse = settlementFigures({ tenders: [{ method: 'cash', amountCents: 11400, internal: 1 }], shortfallCents: 800, shortfallKind: 'waived' });
  assert.equal(allCaisse.bookedWaivedCents, 0, 'a payment entirely in the caisse books no réduction');
});

test('rules 16-17 — the reste due is the last settlement\'s; a collected reste leaves nothing due', () => {
  const first = { id: 1, tenders: [{ method: 'card', amountCents: 11400, internal: 0 }], shortfallCents: 800, shortfallKind: 'due' };
  assert.equal(targetFigures([first]).shortfallDueCents, 800);
  const second = { id: 2, tenders: [{ method: 'cash', amountCents: 800, internal: 1 }], shortfallCents: 0, shortfallKind: null };
  const f = targetFigures([second, first]);
  assert.equal(f.shortfallDueCents, 0);
  assert.equal(f.receivedCents, 12200);
  assert.equal(f.allInternal, false);
});

test('rule 11 — every line in the caisse and nothing left due: the target goes in the caisse whole', () => {
  assert.equal(targetFigures([{ tenders: [{ method: 'cash', amountCents: 100, internal: 1 }], shortfallCents: 0 }]).allInternal, true);
  assert.equal(targetFigures([{ tenders: [{ method: 'cash', amountCents: 100, internal: 1 }], shortfallCents: 50, shortfallKind: 'due' }]).allInternal, false);
  assert.equal(targetFigures([{ tenders: [{ method: 'cash', amountCents: 100, internal: 1 }], shortfallCents: 50, shortfallKind: 'waived' }]).allInternal, true);
});

test('rule 27 — the stay aggregates: a flagged target only takes its geste off the caisse', () => {
  const agg = reservationAggregates([
    { settlements: [today], flagged: false },
    { settlements: [{ id: 3, tenders: [{ method: 'card', amountCents: 9000, internal: 0 }], shortfallCents: 1000, shortfallKind: 'due' }], flagged: false },
    { settlements: [{ id: 4, tenders: [{ method: 'cash', amountCents: 2000, internal: 1 }], shortfallCents: 500, shortfallKind: 'waived' }], flagged: true },
  ]);
  assert.deepEqual(agg, { splitOffBooksAmount: 50, splitWaivedAmount: 0, splitWaivedCashAmount: 5, splitShortfallDue: 10 });
});

test('rule 14 — the history wording names every line, the caisse and the shortfall', () => {
  assert.equal(settlementText(today), 'Espèces 50,00 € (caisse interne) · CB 72,00 €');
  assert.equal(
    settlementText({ tenders: [card(11400)], shortfallCents: 800, shortfallKind: 'waived' }),
    'CB 114,00 € · geste commercial 8,00 €',
  );
});
