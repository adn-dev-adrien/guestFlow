// specs/hosting-h2-account-security.md rule 68, reading of 2026-11-05 (audit R23-A2 section 4) — the reconciliation's writes from a
// valid proposal, one field wrong at a time: its refusal, never a throw (the routes' wrap would answer 500).
const test = require('node:test');
const assert = require('node:assert/strict');
const { build, reset, addReservation, credit, USER, dayAt } = require('./reconciliationFixture');

const T = JSON.parse('{"toString":1}');
const VALUES = [T, { a: 1 }, ['x'], [], [T], [null], true, 1.5, -1, 1e308, 'x', null];

test.beforeEach(() => { reset(); });

function setup() {
  const id = addReservation({ platform: 'Booking', finalPrice: 710.02, balanceAmount: 710.02, platformGrossAmount: 710.02, balanceDueDate: dayAt(-13) });
  const built = build();
  built.transactions.upsertMany([credit('t1', 59658, { counterpartyName: 'Booking.com B.V.', label: 'Booking.com B.V.', reference: 'NO.x/ID.1' })], { bankAccountId: 'acc-1' });
  const item = built.controller.list().body.items.find((i) => i.reservation.id === id);
  return { ...built, id, allocations: item.proposal.allocations, proposalId: item.proposal.id };
}

function leaves(body, prefix = []) {
  return Object.entries(body).flatMap(([key, value]) => {
    const here = [...prefix, key];
    if (Array.isArray(value)) return [here, ...value.slice(0, 1).flatMap((row, i) => (row && typeof row === 'object' ? leaves(row, [...here, i]) : [[...here, i]]))];
    if (value && typeof value === 'object') return [here, ...leaves(value, here)];
    return [here];
  });
}

function withValue(body, keyPath, value) {
  const copy = JSON.parse(JSON.stringify(body));
  let at = copy;
  for (const key of keyPath.slice(0, -1)) at = at[key];
  at[keyPath[keyPath.length - 1]] = value;
  return copy;
}

const METHODS = (s) => [
  ['discard', { transactionId: 't1', reservationId: s.id, ledgerKey: s.allocations[0].ledgerKey }],
  ['confirm', { transactionId: 't1', allocations: s.allocations, user: USER }],
  ['linkBatch', { pairs: s.allocations.map((a) => ({ ...a, transactionId: 't1' })), proposalId: s.proposalId, user: USER }],
  ['previewAllocation', { reservationId: s.id, transactionIds: ['t1'], receiptKeys: [`${s.id}|${s.allocations[0].ledgerKey}`], pairs: s.allocations.map((a) => ({ ...a, transactionId: 't1' })), proposalId: s.proposalId }],
  ['confirmAll', { proposalIds: [s.proposalId], amounts: { [s.proposalId]: 59658 }, user: USER }],
];

test('rule 68 — every write of the reconciliation answers its refusal, field by field', () => {
  const failures = [];
  const s = setup();
  for (const [method, body] of METHODS(s)) {
    for (const keyPath of leaves(body).filter((path) => path[0] !== 'user')) {
      for (const value of VALUES) {
        reset();
        const fresh = setup();
        const sent = withValue(METHODS(fresh).find(([m]) => m === method)[1], keyPath, value);
        sent.user = USER;
        try {
          const answer = fresh.controller[method](sent);
          if (!answer || answer.status >= 500) failures.push(`${method} ${keyPath.join('.')}=${JSON.stringify(value)} → ${answer && answer.status}`);
        } catch (err) {
          failures.push(`${method} ${keyPath.join('.')}=${JSON.stringify(value)} threw ${err.message}`);
        }
      }
    }
  }
  assert.deepEqual([...new Set(failures)], []);
});

test('rule 68 — the wrong types leave no row behind', () => {
  const s = setup();
  s.controller.discard({ transactionId: { a: 1 }, reservationId: true, ledgerKey: ['z'] });
  const { db } = require('./reconciliationFixture');
  assert.deepEqual(db.prepare('SELECT * FROM bank_reconciliation_discards').all(), []);
  assert.deepEqual(db.prepare("SELECT * FROM bank_reconciliation_lines WHERE transactionId LIKE '%object%'").all(), []);
});
