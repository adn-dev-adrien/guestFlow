// specs/pricing-components.md §3 rules 36 and 74 — which payment covered which line, read from what a stay stored before
// `payment_allocations` existed. Per-line truth only; the rest is the stay-level backfill of the next commit.
const test = require('node:test');
const assert = require('node:assert/strict');
const { legacyAllocations } = require('../utils/pricing/legacyAllocations');

const L1 = { ref: 'line:reservation_options:1', key: 'opt:1', acompteContribTtc: 30, soldeContribTtc: 10 };
const L2 = { ref: 'line:reservation_resources:2', key: 'res:2', acompteContribTtc: 0, soldeContribTtc: 20 };
const STAY = { accommodation: 'line:reservation_stay_lines:7', touristTax: 'line:reservation_stay_lines:8' };
const sorted = (rows) => rows.map((r) => `${r.paymentRef}|${r.lineRef}|${r.amountCents}|${r.books}`).sort();

const reservation = {
  depositPaid: 1, depositPaidDate: '2026-03-01', depositAmount: 130, accommodationAcompteContribTtc: 90, touristTaxAcompteContribTtc: 10,
  balancePaid: 1, balancePaidDate: '2026-03-20', balanceAmount: 130, accommodationSoldeContribTtc: 90, touristTaxSoldeContribTtc: 10,
};

test('rule 74: a paid deposit and balance whose contribs add up are allocated line by line, the stay lines included', () => {
  const rows = legacyAllocations({ reservation, lines: [{ ...L1, soldeContribTtc: 10 }, { ...L2, acompteContribTtc: 0 }], stayLines: STAY });
  assert.deepEqual(sorted(rows), [
    'bucket:balance|line:reservation_resources:2|2000|1', 'bucket:balance|line:reservation_options:1|1000|1',
    'bucket:balance|line:reservation_stay_lines:7|9000|1', 'bucket:balance|line:reservation_stay_lines:8|1000|1',
    'bucket:deposit|line:reservation_options:1|3000|1', 'bucket:deposit|line:reservation_stay_lines:7|9000|1', 'bucket:deposit|line:reservation_stay_lines:8|1000|1',
  ].sort());
  assert.equal(rows.find((r) => r.paymentRef === 'bucket:deposit').at, '2026-03-01');
});

test('rule 74: contribs that do not add up to the paid entry describe nothing: no row, left to the stay-level backfill', () => {
  const rows = legacyAllocations({ reservation: { ...reservation, depositAmount: 500 }, lines: [L1, L2], stayLines: STAY });
  assert.ok(!rows.some((r) => r.paymentRef === 'bucket:deposit'));
  assert.ok(rows.some((r) => r.paymentRef === 'bucket:balance'));
});

test('rule 74: the caisse interne is told apart from the books by the flag of the bucket', () => {
  const rows = legacyAllocations({ reservation: { ...reservation, balancePaidCash: 1 }, lines: [L1, L2], stayLines: STAY });
  assert.ok(rows.filter((r) => r.paymentRef === 'bucket:balance').every((r) => r.books === 0));
  assert.ok(rows.filter((r) => r.paymentRef === 'bucket:deposit').every((r) => r.books === 1));
});

test('rule 74: the money a paid line since removed collected stays on the stay, with no line', () => {
  const rows = legacyAllocations({
    reservation: { ...reservation, balancePaid: 0 },
    lines: [{ ...L1, acompteContribTtc: 10 }],
    removed: [{ key: 'opt:9', acompteContribTtc: 20, soldeContribTtc: 0 }],
    stayLines: STAY,
  });
  assert.deepEqual(sorted(rows).filter((row) => row.includes('|null|')), ['bucket:deposit|null|2000|1']);
});

test('rule 74: an unpaid bucket allocates nothing', () => {
  assert.deepEqual(legacyAllocations({ reservation: { ...reservation, depositPaid: 0, balancePaid: 0 }, lines: [L1, L2], stayLines: STAY }), []);
});

test('rule 74: a complement is allocated from its frozen split, by line key, when the lines add up', () => {
  const complement = { complementPaid: 1, complementPaidDate: '2026-04-02', complementAmount: 80, complementPaidCash: 0 };
  const split = { accommodationCents: 3000, taxCents: 500, optionsCents: 4500, resourcesCents: 0, lines: [{ key: 'opt:1', cents: 3000 }, { key: 'custom:thé', cents: 1500 }] };
  const rows = legacyAllocations({ reservation: complement, lines: [L1], stayLines: STAY, complementSplit: split });
  assert.deepEqual(sorted(rows), [
    'bucket:complement|line:reservation_options:1|3000|1', 'bucket:complement|line:reservation_stay_lines:7|3000|1',
    'bucket:complement|line:reservation_stay_lines:8|500|1', 'bucket:complement|null|1500|1',
  ].sort());
  assert.deepEqual(legacyAllocations({ reservation: complement, lines: [L1], stayLines: STAY, complementSplit: { ...split, optionsCents: 1 } }), []);
});

test('rule 74: an end-of-stay complement and a mid-stay note are allocated from their lines, a note on the books or in the caisse', () => {
  const rows = legacyAllocations({
    reservation: { endOfStayComplementPaid: 1, endOfStayComplementPaidDate: '2026-05-04', endOfStayComplementAmount: 25, endOfStayComplementPaidCash: 1 },
    lines: [L1],
    endOfStayDetail: [{ key: 'opt:1', amount: 25 }],
    notes: [{ id: 3, total: 12, paidDate: '2026-05-02', paidCash: 0, lines: [{ key: 'opt:1', amount: 12 }] }, { id: 4, total: 9, paidCash: 1, lines: [{ key: 'opt:1', amount: 8 }] }],
  });
  assert.deepEqual(sorted(rows), ['bucket:endOfStay|line:reservation_options:1|2500|0', 'note:3|line:reservation_options:1|1200|1'].sort());
});

test('rule 74: a paid installment is allocated from its frozen split', () => {
  const split = { accommodationCents: 5000, taxCents: 400, optionsCents: 600, resourcesCents: 0, lines: [{ key: 'opt:1', cents: 600 }] };
  const rows = legacyAllocations({ reservation: {}, lines: [L1], stayLines: STAY, installments: [{ id: 5, paid: 1, paidDate: '2026-06-01', paidSplit: split }, { id: 6, paid: 0, paidSplit: split }] });
  assert.deepEqual(sorted(rows), ['installment:5|line:reservation_options:1|600|1', 'installment:5|line:reservation_stay_lines:7|5000|1', 'installment:5|line:reservation_stay_lines:8|400|1'].sort());
});

test('rule 74 and D25: a live settlement is read from what it RECEIVED, books and caisse apart, and covers its buckets alone', () => {
  const settlement = {
    id: 9, targetKind: 'arrivalGroup', targetKey: 'a', paidDate: '2026-07-01', dueCents: 20000, shortfallCents: 5000, parts: [{ kind: 'balance' }, { kind: 'complement' }],
    tenders: [{ amountCents: 4000, internal: 1 }, { amountCents: 11000, internal: 0 }],
  };
  const rows = legacyAllocations({ reservation: { ...reservation, complementPaid: 1, complementAmount: 70 }, lines: [L1, L2], stayLines: STAY, settlements: [settlement] });
  assert.deepEqual(sorted(rows).filter((r) => r.startsWith('settlement')), ['settlement:9:caisse|null|4000|0', 'settlement:9|null|11000|1']);
  assert.ok(!rows.some((r) => r.paymentRef === 'bucket:balance'), 'the balance is the settlement\'s alone');
  assert.ok(rows.some((r) => r.paymentRef === 'bucket:deposit'), 'the deposit it does not cover is still read from its contribs');
});

test('rule 74: a settlement whose bucket was taken back since is stale and counts for nothing', () => {
  const settlement = { id: 9, targetKind: 'bucket', targetKey: 'balance', paidDate: '2026-07-01', dueCents: 13000, shortfallCents: 0, parts: [{ kind: 'balance' }], tenders: [] };
  assert.deepEqual(legacyAllocations({ reservation: { ...reservation, balancePaid: 0 }, lines: [], stayLines: STAY, settlements: [settlement] })
    .filter((r) => r.paymentRef.startsWith('settlement')), []);
});

test('rule 74: a key naming two lines of the stay is stay-level, never guessed', () => {
  const rows = legacyAllocations({
    reservation: { endOfStayComplementPaid: 1, endOfStayComplementAmount: 10 },
    lines: [{ ref: 'a', key: 'custom:x' }, { ref: 'b', key: 'custom:x' }],
    endOfStayDetail: [{ key: 'custom:x', amount: 10 }],
  });
  assert.deepEqual(sorted(rows), ['bucket:endOfStay|null|1000|1']);
});
