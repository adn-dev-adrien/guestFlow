// specs/pricing-components.md §3 rule 74 (commit « stay-level allocation backfill ») — a paid bucket the stay holds no
// per-line truth for gets its stay-level rows through the legacy tax routing, so Σ allocations of a paid bucket is the bucket
// on every stay of the price-gate fixture. Pure cases first (`legacyAllocations` with `stayLevel`), then the whole fixture.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { legacyAllocations } = require('../utils/pricing/legacyAllocations');

const STAY = { accommodation: 'line:reservation_stay_lines:7', touristTax: 'line:reservation_stay_lines:8' };
const sorted = (rows) => rows.map((r) => `${r.paymentRef}|${r.lineRef}|${r.amountCents}|${r.books}`).sort();

const stay = {
  depositPaid: 1, depositPaidDate: '2026-03-01', depositAmount: 100,
  balancePaid: 1, balancePaidDate: '2026-03-20', balanceAmount: 120, touristTaxTotal: 20,
};

test('rule 74: a paid bucket without per-line truth is one stay-level row; the tourist tax rides the balance on its own line', () => {
  const rows = legacyAllocations({ reservation: stay, stayLines: STAY, stayLevel: { taxRoutedToComplement: false } });
  assert.deepEqual(sorted(rows), [
    'bucket:balance|line:reservation_stay_lines:8|2000|1', 'bucket:balance|null|10000|1', 'bucket:deposit|null|10000|1',
  ].sort());
});

test('rule 74: routed to the complement, the tax is booked on the arrival complement and the balance carries none', () => {
  const rows = legacyAllocations({
    reservation: { ...stay, complementPaid: 1, complementPaidDate: '2026-04-01', complementAmount: 30 },
    stayLines: STAY, stayLevel: { taxRoutedToComplement: true },
  });
  assert.deepEqual(sorted(rows), [
    'bucket:balance|null|12000|1', 'bucket:complement|line:reservation_stay_lines:8|2000|1', 'bucket:complement|null|1000|1',
    'bucket:deposit|null|10000|1',
  ].sort());
});

test('rule 74: without the option nothing is added (the per-line truth stays alone)', () => {
  assert.deepEqual(legacyAllocations({ reservation: stay, stayLines: STAY }), []);
});

test('rule 74: a settled bucket is read from its settlement alone, a plan replaces the deposit and the balance', () => {
  const covered = legacyAllocations({
    reservation: stay, stayLines: STAY, stayLevel: { taxRoutedToComplement: false },
    settlements: [{ id: 5, targetKind: 'bucket', targetKey: 'deposit', paidDate: '2026-03-01', dueCents: 10000, shortfallCents: 0, parts: [{ kind: 'deposit' }], tenders: [] }],
  });
  assert.ok(covered.some((r) => r.paymentRef === 'settlement:5'));
  assert.ok(!covered.some((r) => r.paymentRef === 'bucket:deposit'));
  const plan = legacyAllocations({
    reservation: stay, stayLines: STAY, stayLevel: { taxRoutedToComplement: false },
    installments: [{ id: 1, paid: 1, paidDate: '2026-03-02', amountCents: 6000, paidSplit: null }, { id: 2, paid: 0, paidDate: null, amountCents: 6000, paidSplit: null }],
  });
  assert.deepEqual(sorted(plan), ['installment:1|null|6000|1']);
});

test('rule 74: a cash bucket is off the books, a settled note without lines is one stay-level row of its total', () => {
  const rows = legacyAllocations({
    reservation: { ...stay, balancePaidCash: 1 }, stayLines: STAY, stayLevel: { taxRoutedToComplement: false },
    notes: [{ id: 'n1', total: 12.5, paidDate: '2026-03-10', paidCash: 0, lines: [] }],
  });
  assert.ok(rows.filter((r) => r.paymentRef === 'bucket:balance').every((r) => r.books === 0));
  assert.ok(rows.some((r) => r.paymentRef === 'note:n1' && r.lineRef === null && r.amountCents === 1250 && r.books === 1));
});

const DIR = process.env.PRICE_GATE_FIXTURE_DIR || path.join(__dirname, 'fixtures', 'price-gate');
const captured = fs.existsSync(path.join(DIR, 'inputs.json'));

test('rule 74: on every stay of the price-gate fixture Σ allocations of a paid bucket is the bucket, and a second run writes nothing', { skip: captured ? false : 'price-gate fixture absent' }, () => {
  const inputs = JSON.parse(fs.readFileSync(path.join(DIR, 'inputs.json'), 'utf8'));
  const { freezeClock } = require('./vatRegimeGoldenFixture');
  freezeClock(new Date(inputs.meta.capturedAt));
  const db = require('../database');
  const { loadInputs } = require('../../../scripts/price-gate/recompute');
  loadInputs(db, inputs);

  const cents = (value) => Math.round(Number(value || 0) * 100);
  const sum = db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS n FROM payment_allocations WHERE documentRef = ? AND paymentRef = ? AND kind = 'payment'");
  const BUCKETS = [
    ['deposit', 'bucket:deposit', 'depositPaid', 'depositAmount'], ['balance', 'bucket:balance', 'balancePaid', 'balanceAmount'],
    ['complement', 'bucket:complement', 'complementPaid', 'complementAmount'],
    ['endOfStayComplement', 'bucket:endOfStay', 'endOfStayComplementPaid', 'endOfStayComplementAmount'],
  ];
  let checked = 0;
  const gaps = [];
  for (const stay of db.prepare("SELECT * FROM reservations WHERE kind IN ('reservation', 'cancelled')").all()) {
    const settlements = db.prepare('SELECT parts FROM payment_settlements WHERE reservationId = ?').all(stay.id).flatMap((s) => JSON.parse(s.parts || '[]').map((p) => p.kind));
    const plan = db.prepare('SELECT COUNT(*) AS n FROM reservation_installments WHERE reservationId = ?').get(stay.id).n > 0;
    for (const [kind, ref, flag, amount] of BUCKETS) {
      if (Number(stay[flag]) !== 1 || cents(stay[amount]) <= 0 || settlements.includes(kind) || (plan && (kind === 'deposit' || kind === 'balance'))) continue;
      checked += 1;
      const got = sum.get(`reservation:${stay.id}`, ref).n;
      if (got !== cents(stay[amount])) gaps.push(`stay ${stay.id} ${kind}: ${got} / ${cents(stay[amount])}`);
    }
  }
  assert.ok(checked > 20, `${checked} paid buckets checked`);
  assert.deepEqual(gaps, []);

  const before = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amountCents), 0) AS total FROM payment_allocations').get();
  const lines = require('../utils/pricingLinesMigration');
  assert.equal(lines.backfillStayLevelAllocations(db), 0);
  assert.deepEqual(db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amountCents), 0) AS total FROM payment_allocations').get(), before);
});
