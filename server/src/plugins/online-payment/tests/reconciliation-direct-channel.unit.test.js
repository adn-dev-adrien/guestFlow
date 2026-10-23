// specs/qonto-bank-reconciliation.md rule 43 — a platform marked « Compté comme vente directe » is a
// direct stay: its échéances are the guest's own, not a platform payout.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, addReservation, build, reset } = require('./reconciliationFixture');
const { refreshDirectChannels, setDirectChannels } = require('../../../utils/platformNameFormat');

test.beforeEach(() => { reset(); });
test.afterEach(() => { setDirectChannels([]); });

test('rule 43 — a stay on a platform counted as direct expects its deposit and its own balance, not the gross payout', () => {
  db.prepare("INSERT OR IGNORE INTO platforms (name) VALUES ('Lodgify')").run();
  db.prepare("UPDATE platforms SET countsAsDirect = 1 WHERE name = 'Lodgify'").run();
  refreshDirectChannels(db);
  const id = addReservation({ platform: 'Lodgify', finalPrice: 1000, depositAmount: 300, balanceAmount: 700, depositDueDate: '2026-10-25', balanceDueDate: '2026-11-01' });
  const { controller } = build();
  const lines = controller.compute().items.filter((i) => i.reservation.id === id);
  const byKey = Object.fromEntries(lines.map((i) => [i.ledgerKey, i.expectedCents]));
  assert.equal(byKey.deposit, 30000, 'the deposit is expected');
  assert.equal(byKey.balance, 70000, 'the balance is the échéance, not the gross');
});

test('rule 43 — a real platform keeps its payout row and no deposit receipt', () => {
  const id = addReservation({ platform: 'Booking', finalPrice: 1000, depositAmount: 0, balanceAmount: 1000, platformGrossAmount: 1000, balanceDueDate: '2026-11-01' });
  const { controller } = build();
  const lines = controller.compute().items.filter((i) => i.reservation.id === id);
  assert.deepEqual(lines.map((i) => i.ledgerKey), ['balance']);
  assert.match(lines[0].channel, /^platform:/);
});
