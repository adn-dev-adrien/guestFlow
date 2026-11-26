// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rule 1 — a payment seen paid with no `reservation.paid` event has
// PROVISIONAL tranches on every read (the fiche, « Versements à venir », the journal), derived in memory and never stored.
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const { createSplitsModel } = require('../reconciliation/molliePaymentSplits');
const { db, dayAt, build, reset, paidStay } = require('./mollieFixture');

test.beforeEach(() => {
  reset(); registry.reset(); registry.configure({ isActive: () => true, allows: () => true });
  db.exec('DROP TABLE IF EXISTS zz_write_log; CREATE TABLE zz_write_log (t TEXT);');
});
test.afterEach(() => {
  registry.reset();
  ['i', 'u', 'd'].forEach((k) => db.exec('DROP TRIGGER IF EXISTS zz_final_' + k));
  db.exec('DROP TABLE IF EXISTS zz_write_log');
});

const watch = () => {
  db.exec(`CREATE TRIGGER IF NOT EXISTS zz_final_i AFTER INSERT ON mollie_payment_splits BEGIN INSERT INTO zz_write_log VALUES ('s'); END;
    CREATE TRIGGER IF NOT EXISTS zz_final_u AFTER UPDATE ON mollie_payment_splits BEGIN INSERT INTO zz_write_log VALUES ('s'); END;
    CREATE TRIGGER IF NOT EXISTS zz_final_d AFTER DELETE ON mollie_payment_splits BEGIN INSERT INTO zz_write_log VALUES ('s'); END;`);
  db.exec('DELETE FROM zz_write_log');
};
const writes = () => db.prepare('SELECT t FROM zz_write_log').all();

test('rule 1 — a paid link with no event has tranches on the fiche payload and in « Versements à venir », and nothing is stored', () => {
  const built = build({ startDate: dayAt(-60) });
  createContext('online-payment', { db }).incomingPayments(({ recent }) => built.controller.incomingItems({ recent }));
  const { reservationId } = paidStay({
    cents: 10000, daysAgo: 2, type: 'complement',
    stay: { balanceAmount: 0, balancePaid: 0, balancePaidDate: null, finalPrice: 100, complementAmount: 100, complementDeferredToCheckout: 1, complementPaid: 1, complementPaidDate: dayAt(-2) },
  });
  watch();
  const tranches = built.controller.ledgerTranches(reservationId);
  assert.ok(tranches, 'the fiche has tranches');
  assert.equal(Object.values(tranches.rows).flat().length, 2);
  assert.ok(built.controller.incomingItems({}).some((i) => i.kind === 'mollieTransit'));
  assert.deepEqual(writes(), []);
  assert.equal(createSplitsModel(db).all().length, 0);
});

test('rule 1 — the journal read performs no write, yet books the link of a payment seen without an event', () => {
  const { controller } = build({ startDate: dayAt(-60) });
  paidStay({ cents: 10000, daysAgo: 2 });
  watch();
  const found = controller.journal({ from: dayAt(-2), to: dayAt(-2) });
  assert.deepEqual(found.entries.map((e) => [e.kind, e.amountCents]), [['link', 10000]]);
  assert.deepEqual(writes(), []);
});

test('rule 1 — a paid link the ledger has no row for never counts as unsplit', () => {
  build({ startDate: dayAt(-60) });
  const { link } = paidStay({ cents: 10000, daysAgo: 2 });
  assert.equal(createSplitsModel(db).hasUnsplitLinks(), true, 'a balance link has a ledger row');
  db.pragma('foreign_keys = OFF');
  db.prepare("UPDATE payment_links SET type = 'installment', installmentId = 999999 WHERE id = ?").run(link.id);
  assert.equal(createSplitsModel(db).hasUnsplitLinks(), false, 'an instalment that does not exist has no ledger key, so never a split');
});
