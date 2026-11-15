// specs/mixed-method-payments.md rule 51 (SDK 2.31.0) — the generic core notion of an amount a stay received in advance from a plugin's
// prepaid instrument: a tender line of the method `prepaid` that carries the plugin's source, ref and label; counted as received
// by the stay, never expected at the bank, never an encaissement of the books; held for a quote and settled into a stay through
// the calls the plugin declared. Nothing here names an instrument: the source under test is a made-up « storedCredit ».
// Also the migration that widens the CHECK of `payment_tenders` (rows kept, idempotent).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const registry = require('../plugins/sdk/registry');
const { skipWithout } = require('../plugins/sdk/testing');
const { createContext } = require('../plugins/sdk/createContext');
const tenders = require('../utils/paymentTenders');
const prepaidSources = require('../utils/prepaidSources');
const prepaidReceipts = require('../utils/prepaidReceipts');
const settlementModelOf = (db) => require('../models/paymentSettlementsModel').buildModel(db);
const devisModel = require('../models/devisModel');
const { migratePaymentSettlementsSchema, allowPrepaidTenders, tendersAllowPrepaid } = require('../utils/paymentSettlementsMigration');
const { create: createAccountingOutput } = require('../utils/accounting/accountingOutput');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

const OLD_TENDERS = `
  CREATE TABLE payment_tenders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    settlementId INTEGER NOT NULL REFERENCES payment_settlements(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('card','cash','cheque','transfer','holidayVoucher','other')),
    amountCents INTEGER NOT NULL CHECK (amountCents > 0),
    internal INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0,1) AND (internal = 0 OR method = 'cash'))
  )`;

function oldDatabase() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec('DROP TABLE payment_tenders');
  db.exec(OLD_TENDERS);
  db.exec('CREATE INDEX idx_payment_tenders_settlement ON payment_tenders(settlementId)');
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  db.prepare("INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount) VALUES (1, 'reservation', 1, 1, '2027-05-10', '2027-05-14', 2, 100, 0, 100)").run();
  db.prepare("INSERT INTO payment_settlements (id, reservationId, targetKind, targetKey, paidDate, dueCents, parts) VALUES (1, 1, 'bucket', 'balance', '2027-01-02', 10000, '[]')").run();
  db.prepare("INSERT INTO payment_tenders (settlementId, position, method, amountCents, internal) VALUES (1, 1, 'cash', 4000, 1), (1, 2, 'holidayVoucher', 6000, 0)").run();
  return db;
}

test('migration — the CHECK of payment_tenders is widened to « prepaid », every row kept with its values', () => {
  const db = oldDatabase();
  assert.equal(tendersAllowPrepaid(db), false);
  assert.throws(() => db.prepare("INSERT INTO payment_tenders (settlementId, position, method, amountCents) VALUES (1, 3, 'prepaid', 100)").run(), /CHECK/);

  assert.equal(allowPrepaidTenders(db), 2, 'both rows carried over');
  const rows = db.prepare('SELECT id, settlementId, position, method, amountCents, internal, source, ref, label FROM payment_tenders ORDER BY id').all();
  assert.deepEqual(rows, [
    { id: 1, settlementId: 1, position: 1, method: 'cash', amountCents: 4000, internal: 1, source: null, ref: null, label: null },
    { id: 2, settlementId: 1, position: 2, method: 'holidayVoucher', amountCents: 6000, internal: 0, source: null, ref: null, label: null },
  ]);
  db.prepare("INSERT INTO payment_tenders (settlementId, position, method, amountCents, source, ref, label) VALUES (1, 3, 'prepaid', 100, 'storedCredit', '9', 'Crédit')").run();
  assert.throws(() => db.prepare("INSERT INTO payment_tenders (settlementId, position, method, amountCents) VALUES (1, 4, 'gold', 100)").run(), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO payment_tenders (settlementId, position, method, amountCents, internal) VALUES (1, 5, 'prepaid', 100, 1)").run(), /CHECK/, 'only cash goes to the caisse');
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_payment_tenders_settlement'").get(), 'the index came back');
  db.prepare('DELETE FROM payment_settlements WHERE id = 1').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payment_tenders').get().n, 0, 'the lines still follow their settlement');
});

test('migration — idempotent: a second boot rebuilds nothing, and the whole schema pass keeps the rows', () => {
  const db = oldDatabase();
  migratePaymentSettlementsSchema(db);
  assert.equal(tendersAllowPrepaid(db), true);
  assert.equal(allowPrepaidTenders(db), null);
  migratePaymentSettlementsSchema(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payment_tenders').get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'payment_tenders__new'").get().n, 0);
  const fresh = new Database(':memory:');
  fresh.exec(SCHEMA);
  assert.equal(tendersAllowPrepaid(fresh), true, 'a new database is born with it');
});

test('the operator cannot type a prepaid line: it is not in the method list and a typed one is refused', () => {
  assert.equal(tenders.METHODS.some((m) => m.value === tenders.PREPAID), false);
  const refused = tenders.validateSettlement({ tenders: [{ method: 'prepaid', amountCents: 1000 }], dueCents: 1000 });
  assert.deepEqual([refused.ok, refused.error], [false, 'Moyen de paiement inconnu.']);
});

test('a prepaid line is received money, never collected at the bank nor in the journals', () => {
  const settlement = {
    shortfallCents: 0,
    tenders: [
      { method: 'prepaid', amountCents: 5000, internal: 0, source: 'storedCredit', ref: '3', label: 'Crédit' },
      { method: 'card', amountCents: 3040, internal: 0 },
    ],
  };
  const f = tenders.settlementFigures(settlement);
  assert.deepEqual([f.receivedCents, f.booksCents, f.bankCents, f.prepaidCents, f.collectedCents], [8040, 8040, 3040, 5000, 3040]);
  assert.equal(tenders.lineLabel(settlement.tenders[0]), 'Crédit');
  assert.equal(tenders.lineLabel({ method: 'prepaid' }), 'Prépayé');
  assert.equal(tenders.lineLabel({ method: 'card' }), 'CB');
  assert.match(tenders.settlementText(settlement), /Crédit 50,00 € · CB 30,40 €/);
  const onlyPrepaid = tenders.settlementFigures({ shortfallCents: 0, tenders: [settlement.tenders[0]] });
  assert.deepEqual([onlyPrepaid.collectedCents, onlyPrepaid.bankCents], [0, 0]);
});

test('the accounting export books the collected part of a settlement only', { skip: skipWithout(['accounting-export']) }, () => {
  const output = createAccountingOutput({ accountPlan: require('../plugins/accounting-export/accountPlan') });
  const settlement = {
    id: 1, targetKind: 'bucket', targetKey: 'deposit', parts: [{ kind: 'deposit', amountCents: 8040 }], shortfallCents: 0,
    tenders: [{ method: 'prepaid', amountCents: 5000, internal: 0 }, { method: 'card', amountCents: 3040, internal: 0 }],
  };
  const target = { receivedFactor: 1, waivedFactor: 1, currentCents: 8040 };
  const booked = output.bookedFigures(settlement, target);
  assert.equal(booked.booksCents, 3040);
  assert.ok(Math.abs(booked.share - 3040 / 8040) < 1e-9, 'the entries of the bucket are prorated to what was collected');
});

// ---- a made-up instrument, to prove the core never names one --------------------------------------------------------------

function liveSource(overrides = {}) {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  const held = new Map();
  const calls = [];
  createContext('credit-plugin', {}).prepaid({
    source: 'storedCredit',
    label: 'Crédit boutique',
    apply: ({ devisId, input, capCents, dryRun }) => {
      calls.push(['apply', devisId, dryRun === true]);
      if (input.amountCents <= 0) return { ok: false, status: 409, code: 'EMPTY', message: 'Vide.' };
      const heldCents = Math.min(input.amountCents, capCents);
      if (!dryRun) held.set(devisId, heldCents);
      return { ok: true, heldCents, display: { label: 'Crédit ····42' } };
    },
    held: (devisId) => (held.has(devisId) ? { amountCents: held.get(devisId), display: { label: 'Crédit ····42' } } : null),
    settle: ({ devisId, amountCents }) => { calls.push(['settle', devisId, amountCents]); held.delete(devisId); return amountCents > 0 ? { ref: `use-${devisId}` } : null; },
    release: ({ devisId, reason }) => { calls.push(['release', devisId, reason]); held.delete(devisId); },
    ...overrides,
  });
  return { held, calls };
}

function quoteDatabase({ deposit = 80.4, balance = 187.6 } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  migratePaymentSettlementsSchema(db);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, devisStatus)
    VALUES ('devis', 1, 1, '2027-05-10', '2027-05-14', 2, ?, ?, ?, 'draft')`).run(deposit + balance, deposit, balance).lastInsertRowid);
  return { db, id };
}

test('sources — only a live plugin’s source is asked; a kind nobody declared is refused; the label comes from the plugin', () => {
  liveSource();
  assert.equal(prepaidSources.byKind('storedCredit').pluginId, 'credit-plugin');
  assert.equal(prepaidSources.labelOf('storedCredit'), 'Crédit boutique');
  assert.deepEqual(prepaidSources.apply(1, { kind: 'unknownKind' }, { capCents: 100 }), { ok: false, status: 400, code: 'PREPAID_UNAVAILABLE', message: 'Moyen de paiement indisponible.' });
  assert.equal(prepaidSources.apply(1, null, { capCents: 100 }).code, 'PREPAID_UNAVAILABLE');
  registry.configure({ isActive: () => false, allows: () => true });
  assert.equal(prepaidSources.byKind('storedCredit'), null, 'a plugin switched off holds and prices nothing');
  assert.equal(prepaidSources.heldCentsFor(1), 0);
});

test('sources — a hold lowers what the public payment asks: the earliest amounts first, never below zero', () => {
  const { held } = liveSource();
  held.set(7, 5000);
  assert.equal(prepaidSources.heldCentsFor(7), 5000);
  assert.equal(prepaidSources.reductionCents(7, 8040), 5000);
  assert.equal(prepaidSources.reductionCents(7, 3000), 3000, 'an acompte below the hold: nothing due now');
  assert.equal(prepaidSources.reductionCents(8, 8040), 0);
  const basket = { components: [{ title: 'Séjour', grossCents: 16000, taxable: true }, { title: 'Taxe de séjour', grossCents: 2800, taxable: false }], vatRatePercent: 10 };
  const reduced = prepaidSources.reduceComponents(basket, 5000);
  assert.deepEqual(reduced.components.map((c) => c.grossCents), [11000, 2800], 'the taxable stay line first');
  assert.deepEqual(prepaidSources.reduceComponents(basket, 17000).components.map((c) => c.grossCents), [1800], 'then the tax line');
  assert.equal(prepaidSources.reduceComponents(basket, 0), basket);
});

test('sources — releasing asks every live source, and a source that throws never stops the deletion of a quote', () => {
  const { calls } = liveSource({ release: () => { throw new Error('boom'); } });
  const silent = console.error;
  console.error = () => {};
  try { prepaidSources.releaseFor(3, 'deleted'); } finally { console.error = silent; }
  assert.deepEqual(calls, []);
  const { calls: fine } = liveSource();
  prepaidSources.releaseFor(3, 'deleted');
  assert.deepEqual(fine, [['release', 3, 'deleted']]);
});

test('sources — deleting a quote gives its hold back, through the model, naming no plugin', () => {
  const { held, calls } = liveSource();
  const { db, id } = quoteDatabase();
  held.set(id, 5000);
  assert.equal(devisModel.buildModel(db).remove(id).ok, true);
  assert.deepEqual(calls, [['release', id, 'deleted']]);
});

test('allocate — the acompte first, then the solde; what exceeds both is not used', () => {
  assert.deepEqual(prepaidReceipts.allocate({ depositCents: 8040, balanceCents: 18760, prepaidCents: 5000 }), { deposit: 5000, balance: 0, usedCents: 5000 });
  assert.deepEqual(prepaidReceipts.allocate({ depositCents: 8040, balanceCents: 18760, prepaidCents: 10000 }), { deposit: 8040, balance: 1960, usedCents: 10000 });
  assert.deepEqual(prepaidReceipts.allocate({ depositCents: 8040, balanceCents: 18760, prepaidCents: 30000 }), { deposit: 8040, balance: 18760, usedCents: 26800 });
  assert.deepEqual(prepaidReceipts.allocate({ depositCents: 0, balanceCents: 10000, prepaidCents: 4000 }), { deposit: 0, balance: 4000, usedCents: 4000 });
});

test('conversion — the source redeems what the stay takes (the rest of the hold goes back); each bucket gets one settlement with its lines', () => {
  const { held, calls } = liveSource();
  const { db, id } = quoteDatabase();
  const converted = devisModel.buildModel(db).convertToReservation(id, { allowConflict: true, paidLinkType: 'deposit' });
  const stayId = converted.data.reservationId;
  db.prepare('UPDATE reservations SET depositPaid = 1, depositPaidDate = ?, balancePaid = 1, balancePaidDate = ? WHERE id = ?').run('2027-01-02', '2027-01-02', stayId);
  held.set(id, 9000);
  const settled = prepaidReceipts.settleAtConversion({
    database: db, devisId: id, stayId, linkType: 'deposit', linkCents: 0, paidDate: '2027-01-02',
  });
  assert.equal(settled.usedCents, 9000);
  assert.deepEqual(calls.filter((c) => c[0] === 'settle'), [['settle', id, 9000]]);
  const lines = settlementModelOf(db).listForTarget(stayId, 'bucket', 'deposit').flatMap((s) => s.tenders.map((t) => [t.method, t.amountCents, t.source, t.ref, t.label]));
  assert.deepEqual(lines, [['prepaid', 8040, 'storedCredit', `use-${id}`, 'Crédit boutique']]);
  const balance = settlementModelOf(db).listForTarget(stayId, 'bucket', 'balance')[0];
  assert.deepEqual([balance.tenders[0].amountCents, balance.shortfallCents, balance.shortfallKind], [960, 17800, 'due'], 'the rest of the solde is a reste à percevoir');
  assert.equal(prepaidReceipts.receivedOn(db, stayId, 'storedCredit')[0].amountCents, 8040);
});

test('the fiche — a prepaid line is recorded on the earliest open bucket, an acompte whole or not at all, and taken back only when it is alone', () => {
  liveSource();
  const { db, id } = quoteDatabase({ deposit: 50, balance: 200 });
  const converted = devisModel.buildModel(db).convertToReservation(id, { allowConflict: true });
  const stayId = converted.data.reservationId;
  const base = {
    database: db, stayId, source: 'storedCredit', ref: 11, label: 'Crédit boutique', paidDate: '2027-01-02',
  };
  assert.equal(prepaidReceipts.owedCentsOn(db, stayId), 25000);
  const short = prepaidReceipts.recordOnStay({ ...base, amountCents: 3000 });
  assert.deepEqual([short.ok, short.status], [false, 400]);
  assert.equal(prepaidReceipts.recordOnStay({ ...base, amountCents: 25001 }).ok, false);

  const applied = prepaidReceipts.recordOnStay({ ...base, amountCents: 12000 });
  assert.deepEqual([applied.ok, applied.appliedCents], [true, 12000]);
  assert.equal(prepaidReceipts.owedCentsOn(db, stayId), 13000);
  assert.deepEqual(prepaidReceipts.owedOnStay(db, stayId), [{ bucket: 'balance', dueCents: 13000, open: false }]);
  assert.equal(Number(db.prepare('SELECT splitShortfallDue FROM reservations WHERE id = ?').get(stayId).splitShortfallDue), 130);

  const second = prepaidReceipts.recordOnStay({ ...base, ref: 12, amountCents: 13000 });
  assert.equal(second.ok, true);
  assert.equal(prepaidReceipts.owedCentsOn(db, stayId), 0);
  const blocked = prepaidReceipts.undoOnStay({ database: db, stayId, source: 'storedCredit', ref: 11 });
  assert.deepEqual([blocked.ok, blocked.status], [false, 409], 'a reste already collected rests on the first payment');

  const undone = prepaidReceipts.undoOnStay({ database: db, stayId, source: 'storedCredit', ref: 12 });
  assert.deepEqual([undone.ok, undone.removedCents], [true, 13000]);
  const undoneFirst = prepaidReceipts.undoOnStay({ database: db, stayId, source: 'storedCredit', ref: 11 });
  assert.deepEqual([undoneFirst.ok, undoneFirst.removedCents], [true, 12000]);
  assert.deepEqual(db.prepare('SELECT depositPaid, balancePaid FROM reservations WHERE id = ?').get(stayId), { depositPaid: 0, balancePaid: 0 });
  assert.equal(settlementModelOf(db).listFor(stayId).length, 0);
});

test('the fiche — a settlement shared with a card line is the booking’s own: it is not undone from the fiche', () => {
  liveSource();
  const { db, id } = quoteDatabase({ deposit: 50, balance: 0 });
  const stayId = devisModel.buildModel(db).convertToReservation(id, { allowConflict: true }).data.reservationId;
  db.prepare('UPDATE reservations SET depositPaid = 1, depositPaidDate = ? WHERE id = ?').run('2027-01-02', stayId);
  settlementModelOf(db).insert({
    reservationId: stayId,
    targetKind: 'bucket',
    targetKey: 'deposit',
    paidDate: '2027-01-02',
    dueCents: 5000,
    parts: [{ kind: 'deposit', key: 'deposit', amountCents: 5000 }],
    lines: [
      { method: 'prepaid', amountCents: 2000, internal: false, source: 'storedCredit', ref: '5', label: 'Crédit boutique' },
      { method: 'card', amountCents: 3000, internal: false },
    ],
  });
  const refused = prepaidReceipts.undoOnStay({ database: db, stayId, source: 'storedCredit', ref: 5 });
  assert.deepEqual([refused.ok, refused.status], [false, 409]);
  assert.equal(settlementModelOf(db).listFor(stayId).length, 1, 'nothing was removed');
});
