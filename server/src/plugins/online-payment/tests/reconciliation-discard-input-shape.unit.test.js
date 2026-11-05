// specs/hosting-h2-account-security.md rule 68, reading of 2026-11-05 (audit E23-3) — a discard names a transaction, a stay and a
// ledger key: anything else is 400 INVALID_FIELD_TYPE, no permanent garbage row.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, build, reset, addReservation } = require('./reconciliationFixture');

test.beforeEach(() => { reset(); });
const rows = () => db.prepare('SELECT * FROM bank_reconciliation_discards').all();

test('rule 68 — wrong types are refused and nothing is stored', () => {
  const id = addReservation({});
  const { controller } = build();
  const good = { transactionId: 't1', reservationId: id, ledgerKey: 'solde' };
  const wrong = {
    transactionId: [{ a: 1 }, JSON.parse('{"toString":1}'), ['x'], 5, true, null, ''],
    reservationId: [{ a: 1 }, ['1'], true, 1.5, -1, 0, null, 'x', ''],
    ledgerKey: [{ a: 1 }, JSON.parse('{"toString":1}'), ['z'], 5, true, null, ''],
  };
  for (const [key, values] of Object.entries(wrong)) {
    for (const value of values) {
      const answer = controller.discard({ ...good, [key]: value });
      assert.equal(answer.status, 400, `${key} ${JSON.stringify(value)}`);
      assert.equal(answer.body.code, 'INVALID_FIELD_TYPE');
    }
  }
  assert.deepEqual(rows(), []);
});

test('rule 68 — the fiche\'s own discard still lands, digits of an id included', () => {
  const id = addReservation({});
  const { controller } = build();
  assert.equal(controller.discard({ transactionId: 't1', reservationId: id, ledgerKey: 'solde' }).status, 201);
  assert.equal(controller.discard({ transactionId: 't2', reservationId: String(id), ledgerKey: 'solde' }).status, 201);
  assert.equal(rows().length, 2);
});
