// specs/mixed-method-payments.md rules 16, 27 — the Suivi financier reads a split payment for what it put on the
// books: « encaissé » + « reste à payer » = « total de séjour » holds on every shape, and the « Encaissé » table
// lists one row per settlement that adds up to the tile.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const financeModel = require('../models/financeModel');
const settlements = require('../models/paymentSettlementsModel');
const { comptaCollected, remainingToPay } = require('../utils/reservationSettlement');

const { totalSejour } = financeModel.helpers;
const round2 = (n) => Math.round(n * 100) / 100;

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (1, 'Gîte', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();

function stayWithCleaning(lines, { shortfallCents = 0, shortfallKind = null, cashFlag = 0 } = {}) {
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice,
      depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balancePaidDate,
      endOfStayComplementAmount, endOfStayComplementPaid, endOfStayComplementPaidCash, endOfStayComplementPaidDate)
    VALUES (1, 1, '2026-11-03', '2026-11-08', 'direct', 2, 720, 216, 1, '2026-09-12', 504, 1, '2026-11-03', 122, 1, ?, '2026-11-08')`)
    .run(cashFlag).lastInsertRowid);
  settlements.insert({
    reservationId: id, targetKind: 'bucket', targetKey: 'endOfStayComplement', paidDate: '2026-11-08', dueCents: 12200,
    shortfallCents, shortfallKind, parts: [{ kind: 'endOfStayComplement', key: 'endOfStayComplement', amountCents: 12200 }], lines,
  });
  return db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
}

const CASES = {
  'cash in the caisse + card': [[{ method: 'cash', amountCents: 5000, internal: true }, { method: 'card', amountCents: 7200 }]],
  'reste à percevoir': [[{ method: 'cash', amountCents: 5000, internal: true }, { method: 'card', amountCents: 6400 }], { shortfallCents: 800, shortfallKind: 'due' }],
  'geste commercial': [[{ method: 'cash', amountCents: 5000, internal: true }, { method: 'card', amountCents: 6400 }], { shortfallCents: 800, shortfallKind: 'waived' }],
  'all in the caisse with a geste': [[{ method: 'cash', amountCents: 11400, internal: true }], { shortfallCents: 800, shortfallKind: 'waived', cashFlag: 1 }],
};

for (const [name, [lines, options]] of Object.entries(CASES)) {
  test(`rule 27 — encaissé + reste à payer = total de séjour (${name})`, () => {
    const r = stayWithCleaning(lines, options);
    assert.equal(round2(comptaCollected(r) + remainingToPay(r)), round2(totalSejour(r)));
  });
}

test('rule 27 — the turnover leaves out the caisse and the geste, keeps the reste due', () => {
  assert.equal(totalSejour(stayWithCleaning(...CASES['cash in the caisse + card'])), 792);
  assert.equal(totalSejour(stayWithCleaning(...CASES['reste à percevoir'])), 792);
  assert.equal(totalSejour(stayWithCleaning(...CASES['geste commercial'])), 784);
});
