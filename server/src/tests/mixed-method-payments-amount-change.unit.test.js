// specs/mixed-method-payments.md rules 39-41 — a bucket paid with several methods whose amount moves afterwards
// (a complement adjusted, a final price saved on a locked fiche): a rise is a reste à percevoir, collected like any
// other; a fall cancels the reste, then the geste commercial, and what is left of it is a trop-perçu said on the
// fiche. And the « Notes en séjour » row keeps one reste per note.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const settlementsModel = require('../models/paymentSettlementsModel');
const service = require('../utils/paymentSettlementService');
const { targetFigures } = require('../utils/paymentTenders');
const { comptaCollected, cashCollected, remainingToPay, isSettled } = require('../utils/reservationSettlement');
const { buildLedger } = require('../utils/reservationLedger');
const { getTodayIsoDate } = require('../utils/reservationHelpers');

const TODAY = getTodayIsoDate();
const plain = (text) => String(text).replace(/\s/g, ' ');
db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (1, 'Gîte', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();

const cashIn = (amountCents) => ({ method: 'cash', amountCents, internal: true });
const card = (amountCents) => ({ method: 'card', amountCents, internal: false });
const PART = [{ kind: 'endOfStayComplement', key: 'endOfStayComplement', amountCents: 12200 }];

// A stay over, its 720 € paid by link, the 122 € cleaning paid with several methods today.
function cleaningPaid(lines, { shortfallCents = 0, shortfallKind = null } = {}) {
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice,
      depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balancePaidDate,
      endOfStayComplementAmount, endOfStayComplementPaid, endOfStayComplementPaidDate)
    VALUES (1, 1, date(?, '-5 day'), date(?, '-1 day'), 'direct', 2, 720, 216, 1, ?, 504, 1, ?, 122, 1, ?)`)
    .run(TODAY, TODAY, TODAY, TODAY, TODAY).lastInsertRowid);
  settlementsModel.insert({
    reservationId: id, targetKind: 'bucket', targetKey: 'endOfStayComplement', paidDate: TODAY, dueCents: 12200,
    shortfallCents, shortfallKind, parts: PART, lines,
  });
  return id;
}
// The amount moves the way a save writes it; the save's wrapper refreshes the settlements right after.
function moveCleaningTo(id, euros) {
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = ? WHERE id = ?').run(euros, id);
  settlementsModel.sync(id);
  return db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
}
const figures = (r) => ({ compta: comptaCollected(r), cash: cashCollected(r), remaining: remainingToPay(r), settled: isSettled(r) });

test('specs/mixed-method-payments.md rule 39 — a rise after the payment is a reste à percevoir, off the books', () => {
  const id = cleaningPaid([cashIn(5000), card(7200)]);
  const r = moveCleaningTo(id, 142);
  assert.equal(r.splitShortfallDue, 20);
  // On the books: the 720 € and the 72 € card, never the 20 € not received.
  assert.deepEqual(figures(r), { compta: 792, cash: 50, remaining: 20, settled: false });
});

test('specs/mixed-method-payments.md rule 39 — the reste of a rise is collected like any other, and closes it', () => {
  const id = cleaningPaid([cashIn(5000), card(7200)]);
  moveCleaningTo(id, 142);
  const out = service.collectRemainder({
    reservationId: id, targetKind: 'bucket', targetKey: 'endOfStayComplement', date: TODAY, tenders: [card(2000)],
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  assert.deepEqual(figures(r), { compta: 812, cash: 50, remaining: 0, settled: true });
  // Read again later, the target is covered: no reste comes back.
  assert.equal(targetFigures(settlementsModel.listFor(id), { currentCents: 14200 }).shortfallDueCents, 0);
});

test('specs/mixed-method-payments.md rule 39 — a fall cancels the reste first, then the geste commercial', () => {
  const due = cleaningPaid([cashIn(5000), card(6400)], { shortfallCents: 800, shortfallKind: 'due' });
  assert.deepEqual(figures(moveCleaningTo(due, 114)), { compta: 784, cash: 50, remaining: 0, settled: true });
  const waived = cleaningPaid([cashIn(5000), card(6400)], { shortfallCents: 800, shortfallKind: 'waived' });
  const r = moveCleaningTo(waived, 118);
  assert.equal(r.splitWaivedAmount, 4);
  assert.equal(r.splitShortfallDue, 0);
});

test('specs/mixed-method-payments.md rules 39, 40 — beyond them, a fall is a trop-perçu said on the fiche', () => {
  const id = cleaningPaid([cashIn(5000), card(7200)]);
  const r = moveCleaningTo(id, 100);
  const f = targetFigures(settlementsModel.listFor(id), { currentCents: 10000 });
  assert.equal(f.overpaidCents, 2200);
  // Books and caisse come down together, so collected + remaining still equals the stay's total.
  assert.equal(Math.round(f.booksCents + f.internalCents), 10000);
  assert.equal(r.splitShortfallDue, 0);
  const ledger = buildLedger({ row: r, today: TODAY, settlements: settlementsModel.listFor(id) });
  const row = ledger.rows.find((x) => x.key === 'endOfStayComplement');
  assert.deepEqual(row.split.overpaid.map((o) => plain(o.label)), ['Trop-perçu 22,00 € : le montant a baissé depuis l\'encaissement']);
});

test('specs/mixed-method-payments.md rule 39 — a rise on a target entirely in the caisse is owed, never booked', () => {
  const id = cleaningPaid([cashIn(12200)]);
  db.prepare('UPDATE reservations SET endOfStayComplementPaidCash = 1 WHERE id = ?').run(id);
  const before = figures(moveCleaningTo(id, 122));
  const after = figures(moveCleaningTo(id, 142));
  assert.equal(after.compta, before.compta);
  assert.equal(after.remaining, 20);
  assert.equal(after.cash, 122);
});

test('specs/mixed-method-payments.md rule 41 — two notes each leaving a reste: the notes row offers both', () => {
  const notes = [
    { id: 'n1', paidDate: TODAY, paidCash: 0, total: 30, lines: [] },
    { id: 'n2', paidDate: TODAY, paidCash: 0, total: 40, lines: [] },
  ];
  const row = {
    id: 99, kind: 'reservation', platform: 'direct', startDate: TODAY, endDate: TODAY, finalPrice: 500,
    depositAmount: 0, balanceAmount: 500, balancePaid: 1, balancePaidDate: TODAY, midStaySettledNotes: JSON.stringify(notes),
  };
  const settlement = (id, key, dueCents, receivedCents) => ({
    id, targetKind: 'midStayNote', targetKey: key, paidDate: TODAY, dueCents,
    shortfallCents: dueCents - receivedCents, shortfallKind: 'due',
    parts: [{ kind: 'note', key, amountCents: dueCents }],
    tenders: [{ method: 'card', amountCents: receivedCents, internal: 0 }],
  });
  const ledger = buildLedger({
    row, midStayNotes: notes, today: TODAY, settlements: [settlement(1, 'n1', 3000, 2000), settlement(2, 'n2', 4000, 3500)],
  });
  const notesRow = ledger.rows.find((x) => x.key === 'midStayNotes');
  assert.deepEqual(notesRow.split.remainders.map((r) => [r.targetKey, r.dueCents]), [['n1', 1000], ['n2', 500]]);
});
