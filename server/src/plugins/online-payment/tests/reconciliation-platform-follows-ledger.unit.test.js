// specs/qonto-bank-reconciliation.md rule 43 — « platform » is the ledger's: anything but `direct`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, addReservation, build, reset } = require('./reconciliationFixture');
const { refreshDirectChannels, setDirectChannels } = require('../../../utils/platformNameFormat');

test.beforeEach(() => { reset(); });
test.afterEach(() => { setDirectChannels([]); });

test('rule 43 — an engine stay on a platform counted as direct is still expected as a platform payout', () => {
  db.prepare("INSERT OR IGNORE INTO platforms (name) VALUES ('Lodgify')").run();
  db.prepare("UPDATE platforms SET countsAsDirect = 1 WHERE name = 'Lodgify'").run();
  refreshDirectChannels(db);
  const id = addReservation({ platform: 'Lodgify', finalPrice: 1000, depositAmount: 0, balanceAmount: 1000, platformGrossAmount: 1000, balanceDueDate: '2026-11-01' });
  const { controller } = build();
  const lines = controller.compute().items.filter((i) => i.reservation.id === id);
  assert.deepEqual(lines.map((i) => i.ledgerKey), ['balance']);
  assert.match(lines[0].channel, /^platform:/);
});
