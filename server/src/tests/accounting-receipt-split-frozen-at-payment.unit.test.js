// specs/pricing/pricing-components.md §3 rule 99 (stabilisation loop t1, B-4; completes rule 63 as amended by R2-5) — the sale lines a receipt is cut
// over are frozen per payment day when the money is taken: a paid line removed or offered later never re-cuts a month already declared.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const { freezeStay } = require('../utils/receiptLineSplits');
const { syncStay } = require('../utils/paymentAllocationsSync');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const { skipWithout } = require('../plugins/sdk/testing');
const { create } = require('../utils/accounting/accountingOutput');

const NEEDS_PLAN = { skip: skipWithout(['accounting-export']) };
const REGIME = { regime: 'subject', rate: 10 };
const TODAY = todayIso();
const PAST = addDaysToIsoDate(TODAY, -20);

const frozenRows = (id) => db.prepare('SELECT paidDate, linesJson FROM receipt_line_splits WHERE reservationId = ? ORDER BY paidDate').all(id)
  .map((row) => ({ paidDate: row.paidDate, lines: JSON.parse(row.linesJson) }));

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9901, 'Gel', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9901, 'A', 'Gel')").run();

function stay(readsSaleLines) {
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime, readsSaleLines)
    VALUES (9901, 9901, ?, ?, 'direct', 2, 300, 300, 'reservation', '15:00', ?)`).run(addDaysToIsoDate(TODAY, 30), addDaysToIsoDate(TODAY, 33), readsSaleLines).lastInsertRowid);
}

const line = (ref, vatClass, totalCents, soldAt = `${PAST}T08:00:00.000Z`) => ({ ref, kind: 'option', vatClass, totalCents, soldAt });

test('rule 99 — a past payment day is frozen once with the lines sold by that day; a later change of the lines leaves it as it was', () => {
  const id = stay(1);
  const sold = [line('a', 'options', 4008), line('b', 'drinks', 4008), line('c', 'drinks', 900, `${TODAY}T08:00:00.000Z`)];
  assert.equal(freezeStay(db, { id, readsSaleLines: 1 }, [PAST], { today: TODAY, linesOf: () => sold }), 1);
  assert.deepEqual(frozenRows(id), [{ paidDate: PAST, lines: [{ ref: 'a', kind: 'option', vatClass: 'options', totalCents: 4008 }, { ref: 'b', kind: 'option', vatClass: 'drinks', totalCents: 4008 }] }],
    'the line sold after the payment day is not in its split');
  assert.equal(freezeStay(db, { id, readsSaleLines: 1 }, [PAST], { today: TODAY, linesOf: () => [sold[0]] }), 0, 'the drink removed later changes nothing');
  assert.equal(frozenRows(id)[0].lines.length, 2);
});

test('rule 99 — today\'s row follows the lines until the day is over; a day that no longer holds a payment loses its row', () => {
  const id = stay(1);
  freezeStay(db, { id, readsSaleLines: 1 }, [TODAY], { today: TODAY, linesOf: () => [line('a', 'options', 1000)] });
  freezeStay(db, { id, readsSaleLines: 1 }, [TODAY], { today: TODAY, linesOf: () => [line('a', 'options', 1000), line('b', 'drinks', 500, `${TODAY}T09:00:00.000Z`)] });
  assert.equal(frozenRows(id)[0].lines.length, 2, 'a sale of the day joins the day\'s split');
  assert.equal(freezeStay(db, { id, readsSaleLines: 1 }, [], { today: TODAY, linesOf: () => [] }), 1);
  assert.deepEqual(frozenRows(id), []);
});

test('rule 99 — a stay booked before 4.2.0 is never frozen; a stay that cannot be read as a sale is not frozen either', () => {
  const old = stay(0);
  let read = 0;
  assert.equal(freezeStay(db, { id: old, readsSaleLines: 0 }, [PAST], { today: TODAY, linesOf: () => { read += 1; return []; } }), 0);
  assert.equal(read, 0);
  const unreadable = stay(1);
  assert.equal(freezeStay(db, { id: unreadable, readsSaleLines: 1 }, [PAST], { today: TODAY, linesOf: () => null }), 0);
  assert.deepEqual(frozenRows(unreadable), []);
});

test('rule 99 — the allocation writer every payment path calls freezes the day of a paid receipt', () => {
  const id = stay(1);
  db.prepare('UPDATE reservations SET balanceAmount = 300, balancePaid = 1, balancePaidDate = ?, accommodationSoldeContribTtc = 300 WHERE id = ?').run(PAST, id);
  syncStay(db, id);
  assert.deepEqual(frozenRows(id).map((row) => row.paidDate), [PAST]);
  db.prepare('UPDATE reservations SET balancePaid = 0, balancePaidDate = NULL WHERE id = ?').run(id);
  syncStay(db, id);
  assert.deepEqual(frozenRows(id), [], 'the receipt unticked, its day is free again');
});

test('rule 99 — probe B-4: a deposit cut over two lines keeps its cut when the drink is removed afterwards', NEEDS_PLAN, () => {
  const { receiptCutOf } = create({ accountPlan: require('../plugins/accounting-export/accountPlan') });
  const deposit = {
    kind: 'deposit', paidDate: PAST, encaissementTtc: 80.16, taxTtc: 0, fraction: 1, buckets: [{ name: 'options', ht: 72.87, vat: 7.29, ratePercent: 10 }], commission: null,
  };
  const atPayment = [line('a', 'options', 4008), line('b', 'drinks', 4008)];
  const now = [atPayment[0]];
  const totals = (entry) => entry.buckets.reduce((sum, b) => ({ ht: Math.round((sum.ht + b.ht) * 100) / 100, vat: Math.round((sum.vat + b.vat) * 100) / 100 }), { ht: 0, vat: 0 });
  const cut = (lines, frozen) => receiptCutOf({ id: 1, readsSaleLines: 1 }, { saleLinesOf: () => lines, frozenSplitsOf: () => frozen }, REGIME)(deposit);
  assert.deepEqual(totals(cut(atPayment, new Map())), { ht: 72.88, vat: 7.28 }, 'cut at payment time');
  assert.deepEqual(totals(cut(now, new Map())), { ht: 72.87, vat: 7.29 }, 'the current lines alone would move the month by a cent');
  assert.deepEqual(totals(cut(now, new Map([[PAST, atPayment]]))), { ht: 72.88, vat: 7.28 }, 'the frozen split keeps the declared month');
});
