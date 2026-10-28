// specs/reconciliation-assisted-matching.md rules 12–13 — « Tout confirmer »: what the summary counts, and a
// confirmation per proposal, each in its own transaction, guarded against what changed since the page was
// drawn. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { USER, addReservation, credit, build, reset, row } = require('./reconciliationFixture');
const { applyPaymentMark } = require('../../../utils/reservationPaymentMark');

test.beforeEach(() => { reset(); });

const at = (day) => `${day}T09:00:00.000Z`;

// Two « probable » (client name in the transfer) and one « à vérifier » (exact amount, other name).
function world(opts) {
  const a = addReservation({ balanceAmount: 300, finalPrice: 300, balanceDueDate: '2026-10-10' });
  const b = addReservation({ clientId: 2, balanceAmount: 450.5, finalPrice: 450.5, balanceDueDate: '2026-10-11' });
  const c = addReservation({ clientId: 2, balanceAmount: 125, finalPrice: 125, balanceDueDate: '2026-10-12' });
  const built = build(opts);
  built.transactions.upsertMany([
    credit('ta', 30000, { settledAt: at('2026-10-12'), counterpartyName: 'M. DUPONT' }),
    credit('tb', 45050, { settledAt: at('2026-10-13'), counterpartyName: 'ROSSI Lucia' }),
    credit('tc', 12500, { settledAt: at('2026-10-14'), counterpartyName: 'SOMEONE ELSE' }),
  ], { bankAccountId: 'acc-1' });
  return { ...built, a, b, c };
}
const bulk = (controller) => controller.list({ view: 'todo', filter: 'proposed' }).body.bulk;

test('rule 12 — the summary counts sûr / probable by default and « à vérifier » apart, with totals', () => {
  const { controller } = world();
  const b = bulk(controller);
  assert.equal(b.count, 2);
  assert.equal(b.totalCents, 30000 + 45050);
  assert.equal(b.toVerify.count, 1);
  assert.equal(b.toVerify.totalCents, 12500);
  assert.equal(b.proposalIds.length, 2);
});

test('rule 12 — no proposal in the view: an empty summary', () => {
  addReservation({ balanceAmount: 700, finalPrice: 700 });
  const { controller } = build();
  const b = controller.list({ view: 'todo' }).body.bulk;
  assert.deepEqual([b.count, b.totalCents, b.toVerify.count], [0, 0, 0]);
});

test('rule 13 — confirming the shown ids marks each fiche received at its credit date', () => {
  const { controller, a, b } = world();
  const { proposalIds, amounts } = bulk(controller);
  const answer = controller.confirmAll({ proposalIds, amounts, user: USER });
  assert.equal(answer.status, 200);
  assert.equal(answer.body.confirmed.length, 2);
  assert.equal(answer.body.skipped.length, 0);
  assert.equal(answer.body.totalCents, 75050);
  assert.equal(row(a).balancePaid, 1);
  assert.equal(row(a).balancePaidDate, '2026-10-12');
  assert.equal(row(b).balancePaid, 1);
});

test('rule 13 — « à vérifier » is confirmed only when the ids are sent', () => {
  const { controller, c } = world();
  const b = bulk(controller);
  controller.confirmAll({ proposalIds: b.proposalIds, amounts: b.amounts, user: USER });
  assert.equal(row(c).balancePaid, 0);
  controller.confirmAll({ proposalIds: b.toVerify.proposalIds, amounts: b.toVerify.amounts, user: USER });
  assert.equal(row(c).balancePaid, 1);
});

test('rule 13 — an id that is no longer proposed is skipped as « changed », never confirmed on stale data', () => {
  const { controller, a } = world();
  const { proposalIds, amounts } = bulk(controller);
  controller.confirm({ transactionId: 'ta', allocations: [{ reservationId: a, ledgerKey: 'balance', amountCents: 30000 }], user: USER });
  const answer = controller.confirmAll({ proposalIds, amounts, user: USER }).body;
  assert.equal(answer.confirmed.length, 1);
  assert.deepEqual(answer.skipped.map((s) => s.reason), ['changed']);
  assert.match(answer.skipped[0].message, /a changé/);
});

test('rule 13 — a proposal whose amount moved since the page was drawn is skipped as « changed »', () => {
  const { controller, b } = world();
  const { proposalIds, amounts } = bulk(controller);
  const stale = { ...amounts };
  const bId = proposalIds.find((id) => id.startsWith('tb:'));
  stale[bId] += 100;
  const answer = controller.confirmAll({ proposalIds, amounts: stale, user: USER }).body;
  assert.deepEqual(answer.skipped.map((s) => [s.proposalId, s.reason]), [[bId, 'changed']]);
  assert.equal(row(b).balancePaid, 0);
});

test('rule 13 — one fiche\'s refusal never blocks the others, and stores nothing for its own proposal', () => {
  let refusedId;
  const mark = (args) => (args.reservationId === refusedId ? { status: 422, body: { error: 'La fiche refuse ce marquage.' } } : applyPaymentMark(args));
  const { controller, a, b } = world({ mark });
  refusedId = a;
  const { proposalIds, amounts } = bulk(controller);
  const answer = controller.confirmAll({ proposalIds, amounts, user: USER }).body;
  assert.equal(answer.confirmed.length, 1);
  assert.deepEqual(answer.skipped.map((s) => [s.reason, s.message]), [['refused', 'La fiche refuse ce marquage.']]);
  assert.equal(row(b).balancePaid, 1);
  assert.equal(row(a).balancePaid, 0);
  assert.equal(controller.list({ view: 'todo', filter: 'proposed' }).body.items.some((i) => i.reservation.id === a), true, 'the refused proposal stays in the list');
});

test('rule 13 — the same id sent twice is confirmed once', () => {
  const { controller } = world();
  const { proposalIds, amounts } = bulk(controller);
  const answer = controller.confirmAll({ proposalIds: [...proposalIds, ...proposalIds], amounts, user: USER }).body;
  assert.equal(answer.confirmed.length, 2);
  assert.equal(answer.skipped.length, 0);
});
