// The books after a cancellation (specs/payment-schedule-and-cancellation.md §3.6 rules 30-34).
//
// The acompte was booked as a séjour encaissement, with hébergement VAT, in a month that may already
// be at the accountant's. That month must not change. The cancellation books the requalification in
// its OWN month instead: an avoir reversing the revenue + VAT, an indemnity crediting the same sum
// VAT-free. Which is why the reservation row survives the cancellation.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { cancelReservation } = require('../utils/cancelReservation');
const accountingModelFactory = require('../models/accountingModel');
const reservationsModelFactory = require('../models/reservationsModel');
const refundsModelFactory = require('../models/refundsModel');
const compensationsModelFactory = require('../models/cancellationCompensationsModel');
const paymentLinksModelFactory = require('../models/paymentLinksModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const CANCELLED_ON = '2026-08-19';

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Le Lodge')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Marie', 'Dupont', 'marie@example.com')").run();
  db.prepare(`
    INSERT INTO reservations
      (id, kind, propertyId, clientId, startDate, endDate, platform,
       finalPrice, totalPrice, depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balanceDueDate)
    VALUES
      (10, 'reservation', 1, 1, '2026-09-18', '2026-09-25', 'direct',
       914, 914, 274, 1, '2026-05-12', 640, 0, '2026-08-09')
  `).run();
  return {
    db,
    accounting: accountingModelFactory.create(db),
    deps: {
      database: db,
      reservationsModel: reservationsModelFactory.create(db),
      refundsModel: refundsModelFactory.createModel(db),
      compensationsModel: compensationsModelFactory.buildModel(db),
      paymentLinksModel: paymentLinksModelFactory.buildModel(db),
    },
  };
}

test('the acompte stays booked in ITS month, untouched by the cancellation (rule 34)', () => {
  const { db, accounting, deps } = seed();
  const before = accounting.encaissementsByMonth({ month: 5, year: 2026 });
  assert.equal(before.length, 1);
  assert.equal(before[0].kind, 'deposit');
  assert.equal(before[0].encaissementTtc, 274);

  cancelReservation(deps, 10, { today: CANCELLED_ON, vatRate: 10, reason: 'Solde jamais réglé' });

  const after = accounting.encaissementsByMonth({ month: 5, year: 2026 });
  assert.deepEqual(
    after.map((e) => [e.kind, e.encaissementTtc]),
    before.map((e) => [e.kind, e.encaissementTtc]),
    'a month already exported never changes',
  );
  db.close();
});

test('the cancellation month carries the avoir and the indemnity, and nothing else', () => {
  const { db, accounting, deps } = seed();
  cancelReservation(deps, 10, { today: CANCELLED_ON, vatRate: 10 });

  const refunds = accounting.refundsByMonth({ month: 8, year: 2026 });
  assert.equal(refunds.length, 1, 'the avoir is read even though the stay is cancelled');
  assert.equal(refunds[0].direction, 'refund');
  assert.equal(refunds[0].encaissementTtc, 274);

  const compensations = accounting.compensationsByMonth({ month: 8, year: 2026 });
  assert.equal(compensations.length, 1);
  assert.equal(compensations[0].direction, 'compensation');
  assert.equal(compensations[0].encaissementTtc, 274);

  assert.equal(accounting.encaissementsByMonth({ month: 8, year: 2026 }).length, 0, 'no séjour money moved in August');
  db.close();
});

test('the pair nets to zero: same amount out of the séjour revenue, into the indemnity account', () => {
  const { db, accounting, deps } = seed();
  cancelReservation(deps, 10, { today: CANCELLED_ON, vatRate: 10 });

  const [avoir] = accounting.refundsByMonth({ month: 8, year: 2026 });
  const [indemnity] = accounting.compensationsByMonth({ month: 8, year: 2026 });
  assert.equal(avoir.encaissementTtc, indemnity.encaissementTtc);
  // The avoir reverses VAT (a séjour sale), the indemnity carries none — that is the whole point.
  assert.ok(avoir.buckets.some((b) => b.vat > 0), 'the reversed VAT comes back');
  assert.equal(indemnity.buckets.reduce((t, b) => t + b.vat, 0), 0, 'an indemnity is outside the scope of VAT');
  db.close();
});

test('the journal of the cancellation month balances, entry by entry', () => {
  const { db, accounting, deps } = seed();
  cancelReservation(deps, 10, { today: CANCELLED_ON, vatRate: 10 });
  const { buildRows } = require('../utils/accountingExport');
  const entries = [
    ...accounting.refundsByMonth({ month: 8, year: 2026 }),
    ...accounting.compensationsByMonth({ month: 8, year: 2026 }),
  ];
  const rows = buildRows(entries);
  const totalDebit = rows.reduce((t, r) => t + Number(r['Débit'] || 0), 0);
  const totalCredit = rows.reduce((t, r) => t + Number(r['Crédit'] || 0), 0);
  assert.equal(Math.round(totalDebit * 100), Math.round(totalCredit * 100), 'debits = credits');
  db.close();
});
