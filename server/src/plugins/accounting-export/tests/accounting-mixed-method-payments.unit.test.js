// specs/mixed-method-payments.md rules 18, 26 — a payment split over several methods is booked settlement by
// settlement, at each one's date, for its share on the books (gross of its réduction), and its geste
// commercial as a rabais. The day's cleaning: 122 € = 50 € cash in the caisse + 72 € card.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { create: createAccountingModel } = require('../accountingModel');
const { entryToStructured } = require('../accountingExport');
const { migrateInstallmentsSchema } = require('../../../utils/installmentsMigration');
const { migratePaymentSettlementsSchema } = require('../../../utils/paymentSettlementsMigration');
const { buildModel: buildSettlements } = require('../../../models/paymentSettlementsModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  migrateInstallmentsSchema(db);
  migratePaymentSettlementsSchema(db);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte Revue')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Revue')").run();
  db.prepare(`INSERT INTO reservations (id, propertyId, clientId, kind, platform, startDate, endDate, adults, finalPrice, totalPrice,
      endOfStayComplementAmount, endOfStayComplementPaid, endOfStayComplementPaidDate, endOfStayComplementDetail)
    VALUES (1, 1, 1, 'reservation', 'direct', '2026-11-03', '2026-11-08', 2, 500, 500, 122, 1, '2026-11-08', ?)`) // date-literal-ok: the journal is selected by month, never compared with today
    .run(JSON.stringify([{ key: 'opt:9', label: 'Ménage', amount: 122 }]));
  return db;
}

const PART = [{ kind: 'endOfStayComplement', key: 'endOfStayComplement', amountCents: 12200 }];
const settle = (db, lines, { date = '2026-11-08', shortfallCents = 0, shortfallKind = null, due = 12200 } = {}) => buildSettlements(db).insert({ // date-literal-ok: the journal is selected by month, never compared with today
  reservationId: 1, targetKind: 'bucket', targetKey: 'endOfStayComplement', paidDate: date, dueCents: due,
  shortfallCents, shortfallKind, parts: PART, lines,
});

const journal = (db, month = 11) => createAccountingModel(db).encaissementsByMonth({ month, year: 2026 });
const debit = (entry) => entryToStructured(entry).lines.filter((l) => l.debit).reduce((s, l) => s + Number(l.debit), 0);
const credit = (entry) => entryToStructured(entry).lines.filter((l) => l.credit).reduce((s, l) => s + Number(l.credit), 0);
const round2 = (n) => Math.round(n * 100) / 100;

test('rule 26 — the cleaning books its 72 € card share, balanced; the 50 € of the caisse are not booked', () => {
  const db = seed();
  settle(db, [{ method: 'cash', amountCents: 5000, internal: true }, { method: 'card', amountCents: 7200, internal: false }]);
  const entries = journal(db);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'endOfStayComplement');
  assert.equal(entries[0].encaissementTtc, 72);
  assert.equal(round2(debit(entries[0])), 72);
  assert.equal(round2(credit(entries[0])), 72);
});

test('rule 26 — without a settlement the cleaning books its whole 122 € as before', () => {
  const db = seed();
  const [entry] = journal(db);
  assert.equal(entry.encaissementTtc, 122);
});

test('rules 18, 26 — a geste commercial: the books carry its share gross, then a rabais on 70900000', () => {
  const db = seed();
  settle(db, [{ method: 'cash', amountCents: 5000, internal: true }, { method: 'card', amountCents: 6400, internal: false }], { shortfallCents: 800, shortfallKind: 'waived' });
  const entries = journal(db);
  const sale = entries.find((e) => e.kind === 'endOfStayComplement');
  const rabais = entries.find((e) => e.kind === 'discount');
  const share = Math.round(800 * 6400 / 11400) / 100;
  assert.equal(rabais.encaissementTtc, share);
  assert.equal(sale.encaissementTtc, round2(64 + share));
  // What the client account keeps is the money the card brought.
  assert.equal(round2(sale.encaissementNetTtc - rabais.encaissementTtc), 64);
  assert.ok(entryToStructured(rabais).lines.some((l) => String(l.compte).startsWith('709')));
});

test('rule 17 — a reste collected the next month is booked in that month, at its date', () => {
  const db = seed();
  settle(db, [{ method: 'card', amountCents: 11400, internal: false }], { shortfallCents: 800, shortfallKind: 'due' });
  settle(db, [{ method: 'transfer', amountCents: 800, internal: false }], { date: '2026-12-02', due: 800 }); // date-literal-ok: the journal is selected by month, never compared with today
  assert.equal(journal(db, 11)[0].encaissementTtc, 114);
  const december = journal(db, 12);
  assert.equal(december.length, 1);
  assert.equal(december[0].paidDate, '2026-12-02'); // date-literal-ok: the journal is selected by month, never compared with today
  assert.equal(december[0].encaissementTtc, 8);
});

test('rule 11 — everything in the caisse books nothing', () => {
  const db = seed();
  db.prepare('UPDATE reservations SET endOfStayComplementPaidCash = 1 WHERE id = 1').run();
  settle(db, [{ method: 'cash', amountCents: 12200, internal: true }]);
  assert.deepEqual(journal(db), []);
});

test('rule 39 — the cleaning raised after the payment: the books carry only the 72 € received, balanced', () => {
  const db = seed();
  settle(db, [{ method: 'cash', amountCents: 5000, internal: true }, { method: 'card', amountCents: 7200, internal: false }]);
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 142 WHERE id = 1').run();
  const [entry] = journal(db);
  assert.equal(entry.encaissementTtc, 72);
  assert.equal(round2(debit(entry)), round2(credit(entry)));
});

test('rule 39 — the cleaning lowered beyond its geste: the geste is gone, the card share comes down with the amount', () => {
  const db = seed();
  settle(db, [{ method: 'cash', amountCents: 5000, internal: true }, { method: 'card', amountCents: 6400, internal: false }], { shortfallCents: 800, shortfallKind: 'waived' });
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 100 WHERE id = 1').run();
  const entries = journal(db);
  assert.equal(entries.some((e) => e.kind === 'discount'), false);
  const sale = entries.find((e) => e.kind === 'endOfStayComplement');
  // 14 € received beyond the 100 € now owed, taken off the books and the caisse alike: 64 × 100/114.
  assert.equal(sale.encaissementTtc, round2(64 * 100 / 114));
  assert.equal(round2(debit(sale)), round2(credit(sale)));
});
