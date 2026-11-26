// specs/payments/disable-deposit-per-reservation.md rules 1-3, 5-9 and 10-11 (server side): « Sans acompte » on one
// fiche. The engine rule is pinned in pricing-deposit-disabled.unit.test.js, the link-paid rules in their own
// suites; the switch itself (UI) in client FinanceSection.sans-acompte.test.jsx.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, inDays, createStay, rowOf, save, liveQuote } = require('./ledgerFixture');
const { buildAuditSnapshotFromPayload, computeAuditChanges } = require('../utils/reservationAudit');
const enforceRoleAccess = require('../middleware/enforceRoleAccess');

test('rule 1: the column exists, NOT NULL, default 0 — every stay is opt-in', () => {
  const id = createStay();
  const column = db.prepare('PRAGMA table_info(reservations)').all().find((c) => c.name === 'depositDisabled');
  assert.ok(column);
  assert.equal(column.notnull, 1);
  assert.equal(String(column.dflt_value), '0');
  assert.equal(rowOf(id).depositDisabled, 0);
});

test('rule 3: switched off (default), the standard split applies', () => {
  const id = createStay();
  const row = rowOf(id);
  assert.ok(row.depositAmount > 0);
  assert.equal(row.depositAmount + row.balanceAmount > row.depositAmount, true);
});

test('rule 2: switched on, the acompte is 0 and the solde absorbs it, on every recompute', async () => {
  const standard = rowOf(createStay());
  const id = createStay({ depositDisabled: 1 });
  const row = rowOf(id);
  assert.deepEqual(
    [row.depositDisabled, row.depositAmount, row.depositPaid, row.depositPaidDate, row.depositDueDate],
    [1, 0, 0, null, null],
  );
  assert.equal(Math.round((row.balanceAmount) * 100), Math.round((standard.depositAmount + standard.balanceAmount) * 100));
  // A save keeps the flag, and so does the live quote of the fiche.
  assert.equal((await save(id, { depositDisabled: 1 })).statusCode, 200);
  assert.deepEqual([rowOf(id).depositAmount, rowOf(id).depositDueDate], [0, null]);
  const quote = await liveQuote(id, { depositDisabled: true });
  assert.equal(quote.depositAmount, 0);
});

test('rule 5: switching back OFF re-derives the split from the property percent', async () => {
  const standard = rowOf(createStay());
  const id = createStay({ depositDisabled: 1 });
  assert.equal(rowOf(id).depositAmount, 0);
  assert.equal((await save(id, { depositDisabled: 0 })).statusCode, 200);
  const row = rowOf(id);
  assert.equal(row.depositDisabled, 0);
  assert.equal(row.depositAmount, standard.depositAmount);
  assert.equal(row.balanceAmount, standard.balanceAmount);
});

test('rule 6: a past fiche can still switch the acompte off, while another change stays locked', async () => {
  const id = createStay();
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(inDays(-10), inDays(-7), id);
  const locked = await save(id, { adults: 3 });
  assert.deepEqual([locked.statusCode, locked.body.code], [400, 'PAST_RESERVATION_LOCKED']);
  const off = await save(id, { depositDisabled: 1 });
  assert.equal(off.statusCode, 200, JSON.stringify(off.body));
  assert.equal(rowOf(id).depositDisabled, 1);
});

test('rule 7: the toggle is part of the audit snapshot and diffed', () => {
  const base = { propertyId: 1, clientId: 1, startDate: inDays(30), endDate: inDays(33), adults: 2 };
  const before = buildAuditSnapshotFromPayload({ ...base, depositDisabled: 0 }, {});
  const after = buildAuditSnapshotFromPayload({ ...base, depositDisabled: 1 }, {});
  assert.equal(before.depositDisabled, 0);
  assert.equal(after.depositDisabled, 1);
  const changes = computeAuditChanges(before, after);
  assert.deepEqual(changes.map((c) => c.field), ['depositDisabled']);
});

test('rule 8: the ledger reads « Sans objet · acompte désactivé » and the solde carries the whole pre-arrival total', async () => {
  const id = createStay({ depositDisabled: 1 });
  const quote = await liveQuote(id, { depositDisabled: true });
  const deposit = quote.ledger.rows.find((r) => r.key === 'deposit');
  assert.equal(deposit.stateLabel, 'Sans objet · acompte désactivé');
  assert.equal(rowOf(id).depositAmount, 0);
  assert.ok(rowOf(id).balanceAmount > 0);
});

test('rule 9: the switch needs no gating of its own — admin edits the fiche, the accountant is refused FORBIDDEN_ROLE by the role guard', () => {
  const run = (user) => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    let passed = false;
    enforceRoleAccess({ user, method: 'PUT', path: '/reservations/1' }, res, () => { passed = true; });
    return { passed, res };
  };
  assert.equal(run({ roles: ['admin'] }).passed, true);
  const refused = run({ roles: ['accountant'] });
  assert.equal(refused.passed, false);
  assert.deepEqual([refused.res.statusCode, refused.res.body], [403, { error: 'FORBIDDEN_ROLE' }]);
});

test('rule 10-11: a 0 € acompte carries no deadline, whatever the fiche posted back', async () => {
  const id = createStay({ depositDisabled: 1, depositDueDate: inDays(200) });
  assert.equal(rowOf(id).depositDueDate, null);
});
