// specs/accounting-books-the-money-collected.md rules 13-14 (spec review of 2026-10-27, agent 3 F1-F2) —
// an entry for money already collected never moves (specs/accountant-accounting-export.md rule 33):
//   - a tourist tax that rises after the solde was paid is booked with the arrival complement that
//     collects it, never by rewriting the solde entry;
//   - an installment books the split frozen when it was collected, whatever the fiche becomes.
// Test data of the review: 100 €/night × 5, 1,50 €/adult/night, acompte 30 % → 150 + 365 (15 € of tax).

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { create: createAccountingModel } = require('../accountingModel');
const { entryToStructured } = require('../accountingExport');
const { recordInstallmentPayment } = require('../../../utils/installmentPayment');
const { migrateInstallmentsSchema } = require('../../../utils/installmentsMigration');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'schema.sql'), 'utf8');

function seed(reservation = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  migrateInstallmentsSchema(db);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte Revue')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Revue')").run();
  const row = {
    id: 1, propertyId: 1, clientId: 1, kind: 'reservation', platform: 'direct',
    startDate: '2027-06-10', endDate: '2027-06-15', adults: 2,
    finalPrice: 500, totalPrice: 500, touristTaxTotal: 15,
    depositAmount: 150, depositPaid: 1, depositPaidDate: '2026-10-27',
    balanceAmount: 365, balancePaid: 1, balancePaidDate: '2026-10-27',
    accommodationAcompteContribTtc: 150, touristTaxAcompteContribTtc: 0,
    accommodationSoldeContribTtc: 350, touristTaxSoldeContribTtc: 15,
    ...reservation,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO reservations (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row);
  return db;
}

const journal = (db, month = 10, year = 2026) => createAccountingModel(db)
  .encaissementsByMonth({ month, year })
  .map((entry) => ({ kind: entry.kind, lines: entryToStructured(entry).lines.map((l) => `${l.compte} ${l.debit ? `D${l.debit}` : `C${l.credit}`}`) }));

test('rule 13 — a tax rise after the solde is paid leaves the solde entry as it was exported', () => {
  const db = seed();
  const before = journal(db).find((e) => e.kind === 'balance');
  assert.ok(before.lines.includes('46710000 C15'));

  // One guest more: the tax goes to 22,50 € and the engine bills the 7,50 € on the arrival complement.
  db.prepare('UPDATE reservations SET touristTaxTotal = 22.5, complementAmount = 7.5 WHERE id = 1').run();
  const after = journal(db).find((e) => e.kind === 'balance');
  assert.deepEqual(after.lines, before.lines, 'the October solde keeps its cents');
});

test('rule 13 — the complement that collects the rise books it on 46710000, in its own month', () => {
  const db = seed({ touristTaxTotal: 22.5, complementAmount: 7.5, complementPaid: 1, complementPaidDate: '2026-11-03' });
  const november = journal(db, 11);
  assert.equal(november.length, 1);
  assert.equal(november[0].kind, 'complement');
  assert.deepEqual(november[0].lines.filter((l) => l.includes(' C')), ['46710000 C7.5']);
  // The whole stay, every month together, books exactly the money collected: 150 + 365 + 7,50.
  const debits = [...journal(db), ...november].flatMap((e) => e.lines).filter((l) => l.includes(' D'))
    .reduce((sum, l) => sum + Number(l.split(' D')[1]), 0);
  assert.equal(Math.round(debits * 100) / 100, 522.5);
});

test('rule 13 — a solde paid before contribs existed keeps booking the live tax', () => {
  const db = seed({
    accommodationAcompteContribTtc: null, touristTaxAcompteContribTtc: null,
    accommodationSoldeContribTtc: null, touristTaxSoldeContribTtc: null,
  });
  const taxOf = () => Number(journal(db).find((e) => e.kind === 'balance').lines.find((l) => l.startsWith('46710000')).split(' C')[1]);
  assert.ok(Math.abs(taxOf() - 15) <= 0.02);
  db.prepare('UPDATE reservations SET touristTaxTotal = 22.5 WHERE id = 1').run();
  assert.ok(Math.abs(taxOf() - 22.5) <= 0.02, 'no frozen share to read: the live tax, as before');
});

function seedPlan() {
  const db = seed({
    depositAmount: 0, depositPaid: 0, depositPaidDate: null, balanceAmount: 0, balancePaid: 0, balancePaidDate: null,
    accommodationAcompteContribTtc: null, touristTaxAcompteContribTtc: null,
    accommodationSoldeContribTtc: null, touristTaxSoldeContribTtc: null,
    installmentsUnpaidAmount: 515, installmentsTarget: 515,
  });
  const insert = db.prepare('INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents) VALUES (1, ?, ?, ?)');
  insert.run(1, '2026-10-27', 17200);
  insert.run(2, '2026-12-27', 17200);
  insert.run(3, '2027-02-27', 17100);
  return db;
}

// specs/direct-installments.md rule 47 + specs/accounting-books-the-money-collected.md rule 14 — the
// installment keeps the split it was booked with.
test('rule 14 — an installment of a past month does not move when the fiche is saved later', () => {
  const db = seedPlan();
  const { flipped } = recordInstallmentPayment({ db }, { installmentId: 1, paidDate: '2026-10-27', method: 'transfer' });
  assert.equal(flipped, true);
  const before = journal(db);
  assert.deepEqual(before.map((e) => e.kind), ['installment']);
  assert.ok(before[0].lines.includes('46710000 C5.01'), before[0].lines.join(' | '));

  // A guest more (tax 22,50 €) and a 60 € option: the unpaid installments absorb the rise.
  db.prepare('UPDATE reservations SET finalPrice = 560, touristTaxTotal = 22.5 WHERE id = 1').run();
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount) VALUES (1, 'Ménage', 60)").run();
  db.prepare('UPDATE reservation_installments SET amountCents = amountCents + 3375 WHERE paid = 0').run();
  assert.deepEqual(journal(db), before);
});

// specs/direct-installments.md rule 47 + specs/accounting-books-the-money-collected.md rule 14 — the
// stored split adds up and keeps the plan's tax share.
test('rule 14 — the frozen split adds up to the installment and keeps the plan’s tax share', () => {
  const db = seedPlan();
  recordInstallmentPayment({ db }, { installmentId: 1, paidDate: '2026-10-27', method: 'transfer' });
  const split = JSON.parse(db.prepare('SELECT paidSplit FROM reservation_installments WHERE id = 1').get().paidSplit);
  assert.deepEqual(split, { taxCents: 501, accommodationCents: 16699, optionsCents: 0, resourcesCents: 0 });
});
