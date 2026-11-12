// specs/pricing-components.md §3 rule 72 — REFUNDS / register: what a refund is (book money, caisse interne, the `retained`
// requalification avoir), its lines (sale, indemnity, commission), the order of a refund relative to the cancellation and
// the per-line sums. The legacy module re-exports the same functions; the register keeps its own `round2` (rule 38).
const test = require('node:test');
const assert = require('node:assert/strict');
const register = require('../utils/pricing/refunds/register');
const legacy = require('../utils/refunds');
const { roundMoney } = require('../utils/pricing/money');

const {
  isOffBooks, isRetainedDeposit, isRequalification, isIndemnityLine, isCommissionLine, refundedByKey,
  nettedByCancellation, madeAfterCancellation, writtenBeforeAvoir, billedLineKey, lineLabelOf,
} = register;

test('rule 72 — the legacy module re-exports the register', () => {
  for (const name of ['isOffBooks', 'isRetainedDeposit', 'isIndemnityLine', 'nettedByCancellation', 'madeAfterCancellation', 'refundedByKey', 'billedLineKey', 'round2', 'COMMISSION_KEY']) {
    assert.equal(legacy[name], register[name], name);
  }
});

test('rule 72 — classification of a refund and of its lines', () => {
  assert.equal(isOffBooks('internal'), true);
  assert.equal(isOffBooks('transfer'), false);
  assert.equal(isRetainedDeposit('retained'), true);
  assert.equal(isRetainedDeposit('cash'), false);
  assert.equal(isRequalification({ method: 'retained' }), true);
  assert.equal(isRequalification({ method: 'transfer' }), false);
  assert.equal(isRequalification(null), false);
  assert.equal(isIndemnityLine({ bucket: 'indemnity' }), true);
  assert.equal(isIndemnityLine({ bucket: 'options' }), false);
  assert.equal(isCommissionLine({ lineKey: 'commission' }), true);
  assert.equal(isCommissionLine(null), false);
});

test('rule 72 — a line is named by its billed key and its label falls back to « Prestation »', () => {
  assert.equal(billedLineKey({ optionId: 7 }), 'opt:7');
  assert.equal(billedLineKey({ resourceId: 2 }), 'res:2');
  assert.equal(lineLabelOf({ title: ' Bain nordique ' }), 'Bain nordique');
  assert.equal(lineLabelOf({}), 'Prestation');
});

test('rule 72 — refundedByKey sums every means per key, in cents, and honours a filter', () => {
  const refunds = [
    { method: 'transfer', lines: [{ lineKey: 'opt:7', amountTtc: 10.1 }, { lineKey: null, amountTtc: 5 }] },
    { method: 'internal', lines: [{ lineKey: 'opt:7', amountTtc: 20.2 }] },
    { method: 'retained', lines: [{ lineKey: 'accommodation', amountTtc: 30 }] },
  ];
  assert.deepEqual(refundedByKey(refunds), { 'opt:7': 30.3, accommodation: 30 });
  assert.deepEqual(refundedByKey(refunds, isRequalification), { accommodation: 30 });
  assert.deepEqual(refundedByKey(refunds, () => true, (line) => line.amountTtc > 20), { 'opt:7': 20.2, accommodation: 30 });
  assert.deepEqual(refundedByKey(null), {});
});

test('rule 72 — order: a refund below the last avoir was netted by the cancellation, one above it was made after', () => {
  const before = { id: 1, method: 'transfer' };
  const avoir = { id: 2, method: 'retained' };
  const after = { id: 3, method: 'transfer' };
  const caisse = { id: 0, method: 'internal' };
  const refunds = [before, avoir, after, caisse];
  assert.equal(writtenBeforeAvoir(refunds)(before), true);
  assert.equal(writtenBeforeAvoir(refunds)(after), false);
  assert.equal(nettedByCancellation(before, refunds), true);
  assert.equal(nettedByCancellation(after, refunds), false);
  assert.equal(nettedByCancellation(caisse, refunds), false, 'the caisse interne is off the books: never netted');
  assert.equal(nettedByCancellation(avoir, refunds), false);
  assert.equal(nettedByCancellation(before, refunds, new Set([9])), false, 'a refund the avoir did not read is not netted');
  assert.equal(nettedByCancellation(before, refunds, new Set([1])), true);
  assert.equal(madeAfterCancellation(after, refunds, null), true);
  assert.equal(madeAfterCancellation(before, refunds, null), false);
  assert.equal(madeAfterCancellation(avoir, refunds, null), false);
});

test('rule 72 — without an avoir, a refund is after the cancellation by its flag, else by its creation stamp', () => {
  assert.equal(madeAfterCancellation({ afterCancellation: 1 }, [], null), true);
  assert.equal(madeAfterCancellation({ afterCancellation: 0, createdAt: '2099-01-01 10:00:00' }, [], '2000-01-01 10:00:00'), false); // date-literal-ok: stamps compared with each other only
  assert.equal(madeAfterCancellation({ createdAt: '2000-01-02 10:00:00' }, [], '2000-01-01 10:00:00'), true); // date-literal-ok: stamps compared with each other only
  assert.equal(madeAfterCancellation({ createdAt: '2000-01-02 10:00:00' }, [], null), false, 'unknown is not after'); // date-literal-ok: stamps compared with each other only
});

test('rule 38 — the register keeps its own round2: a non-numeric reads 0, where money.roundMoney reads NaN', () => {
  assert.equal(register.round2('abc'), 0);
  assert.equal(register.round2(0.1 + 0.2), 0.3);
  assert.ok(Number.isNaN(roundMoney('abc')));
});

// ── rule 72, PR B: the contract names ────────────────────────────────────────────────────────────────────────────────────

test('rule 72 — classify: a retained avoir is a requalification, a caisse-interne refund is off the books', () => {
  assert.deepEqual(register.classify({ method: 'transfer' }), { kind: 'refund', book: true, offBooks: false });
  assert.deepEqual(register.classify({ method: 'internal' }), { kind: 'refund', book: false, offBooks: true });
  assert.deepEqual(register.classify({ method: 'retained' }), { kind: 'requalification', book: true, offBooks: false });
  assert.deepEqual(register.classifyLine({ bucket: 'indemnity' }), { source: 'indemnity' });
  assert.deepEqual(register.classifyLine({ lineKey: 'commission', bucket: 'accommodation' }), { source: 'commission' });
  assert.deepEqual(register.classifyLine({ lineKey: 'opt:1', bucket: 'options' }), { source: 'sale' });
});

const REGISTER = [
  { id: 1, method: 'transfer', totalTtc: 100, lines: [{ lineKey: 'opt:1', bucket: 'options', amountTtc: 60 }, { lineKey: null, bucket: 'accommodation', amountTtc: 40 }] },
  { id: 2, method: 'internal', totalTtc: 20, lines: [{ lineKey: 'touristTax', bucket: 'touristTax', amountTtc: 20, quantity: 5 }] },
  { id: 3, method: 'retained', totalTtc: 50, lines: [{ lineKey: 'accommodation', bucket: 'indemnity', amountTtc: 50 }] },
];

test('rule 72 — totals: one declared filter per scope (given, journal, turnover, commune)', () => {
  const read = (scope) => register.totals(REGISTER, { scope });
  assert.deepEqual([read('given').bookCents, read('given').withCashCents], [10000, 12000], 'the avoir gave nothing back, the caisse is not book money');
  assert.deepEqual([read('journal').bookCents, read('journal').withCashCents], [15000, 15000], 'the avoir is a journal entry, the caisse is not');
  assert.deepEqual([read('turnover').bookCents, read('turnover').withCashCents], [15000, 17000], 'the cash reading adds the caisse interne');
  assert.deepEqual([read('commune').bookCents, read('commune').withCashCents], [17000, 17000], 'every means is owed to the commune');
  assert.deepEqual(read('given').touristTax, { cents: 2000, nights: 5 });
  assert.equal(read('given').freeCents, 4000);
  assert.equal(read('journal').indemnityCents, 5000);
  assert.equal(read('given').indemnityCents, 0, 'the avoir is not in the given scope');
  assert.deepEqual(read('given').byKey, { 'opt:1': 6000, touristTax: 2000 });
  assert.throws(() => register.totals(REGISTER, { scope: 'everything' }), /unknown scope/);
});

test('rule 72 — the SQL predicate of a scope is the JS one on every means', () => {
  const Database = require('better-sqlite3');
  const sql = new Database(':memory:');
  for (const scope of Object.keys(register.SCOPES)) {
    for (const reading of ['book', 'withCash']) {
      for (const method of ['transfer', 'cash', 'internal', 'retained']) {
        const inSql = sql.prepare(`SELECT (${register.scopeSql(scope, reading, '?')}) AS keep`).get(...Array(
          (register.scopeSql(scope, reading, '?').match(/\?/g) || []).length).fill(method)).keep === 1;
        assert.equal(inSql, register.SCOPES[scope][reading](method), `${scope}.${reading} on ${method}`);
      }
    }
  }
});

test('rule 72 — order: after the cancellation, before the avoir, netted by it', () => {
  const refunds = [{ id: 1, method: 'transfer' }, { id: 5, method: 'retained' }, { id: 7, method: 'cash' }];
  const order = register.order(refunds, '2026-01-01 10:00:00', new Set([1]));
  assert.equal(order.beforeAvoir(refunds[0]), true);
  assert.equal(order.beforeAvoir(refunds[2]), false);
  assert.equal(order.after(refunds[2]), true);
  assert.equal(order.netted(refunds[0]), true);
});
