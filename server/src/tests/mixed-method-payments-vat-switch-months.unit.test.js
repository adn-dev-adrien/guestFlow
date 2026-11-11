// specs/mixed-method-payments.md rule 49 (audit R34-M-L1) — the months a VAT regime switch says it rewrites
// (vat-optional-mode rule 17) include those where a split payment booked a settlement only: a reste collected later is
// booked in its own month. A settlement entirely in the caisse interne books nothing and adds no month.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const settlementsModel = require('../models/paymentSettlementsModel');
const { __test: { monthsOfPayments } } = require('../models/vatRegimeSwitchModel');
const { getTodayIsoDate } = require('../utils/reservationHelpers');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const TODAY = getTodayIsoDate();
const FIRST = addDaysToIsoDate(TODAY, -40);
const month = (iso) => iso.slice(0, 7);
db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (1, 'Gîte', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();

function soldeWithReste() {
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice,
      depositAmount, balanceAmount, balancePaid, balancePaidDate)
    VALUES (1, 1, ?, ?, 'direct', 2, 500, 0, 500, 1, ?)`).run(addDaysToIsoDate(TODAY, 10), addDaysToIsoDate(TODAY, 12), FIRST).lastInsertRowid);
  const part = [{ kind: 'balance', key: 'balance', amountCents: 50000 }];
  settlementsModel.insert({
    reservationId: id, targetKind: 'bucket', targetKey: 'balance', paidDate: FIRST, dueCents: 50000,
    shortfallCents: 10000, shortfallKind: 'due', parts: part, lines: [{ method: 'card', amountCents: 40000, internal: false }],
  });
  return { id, part };
}

test('specs/mixed-method-payments.md rule 49 — the month a reste was collected in is a month the switch rewrites', () => {
  const { id, part } = soldeWithReste();
  settlementsModel.insert({
    reservationId: id, targetKind: 'bucket', targetKey: 'balance', paidDate: TODAY, dueCents: 10000,
    parts: part, lines: [{ method: 'transfer', amountCents: 10000, internal: false }],
  });
  assert.deepEqual(monthsOfPayments(db, [id]), [month(FIRST), month(TODAY)]);
});

test('specs/mixed-method-payments.md rule 49 — a reste collected in the caisse interne books no month', () => {
  const { id, part } = soldeWithReste();
  settlementsModel.insert({
    reservationId: id, targetKind: 'bucket', targetKey: 'balance', paidDate: TODAY, dueCents: 10000,
    parts: part, lines: [{ method: 'cash', amountCents: 10000, internal: true }],
  });
  assert.deepEqual(monthsOfPayments(db, [id]), [month(FIRST)]);
});
