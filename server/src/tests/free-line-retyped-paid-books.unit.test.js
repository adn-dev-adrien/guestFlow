// specs/pricing/pricing-components.md §3 rule 94 reading (loop t16 S16-3 b) and specs/accounting/accounting-books-the-money-collected.md rule 17 — the books
// reviewer's round-17 probe `p17-retype` made permanent (stabilisation loop t17, 2026-11-18). A free line the solde paid, removed and typed
// again under the same label in one fiche save, is a new row; what the books read does not move: each payment's allocations keep their total
// and point at no line that is gone, the paid solde's journal entry is identical, the frozen receipt split of the past payment day is
// unchanged. The same line kept (its row id named) is the control. A line paid by a note cannot leave that way: 409 LINE_PAID, nothing written.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');
const alloc = require('../utils/paymentAllocationsSync');
const { applyPaymentMark } = require('../utils/reservationPaymentMark');
const { changeLine } = require('../utils/extraSale');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const acct = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));

let FQ;
test.before(async () => { FQ = await import(pathToFileURL(path.join(__dirname, '../../../client/src/utils/ficheQuoteBody.js')).href); });

const lines = (id) => db.prepare('SELECT id, lineId, description, amount FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id').all(id);
const allocations = (id) => {
  alloc.syncStay(db, id);
  const rows = db.prepare("SELECT paymentRef, lineRef, amountCents FROM payment_allocations WHERE documentRef = ? AND kind = 'payment' ORDER BY paymentRef, lineRef").all(`reservation:${id}`);
  const refs = new Set(lines(id).map((l) => `line:reservation_custom_options:${l.lineId}`));
  const byPayment = {};
  for (const r of rows) byPayment[r.paymentRef] = (byPayment[r.paymentRef] || 0) + r.amountCents;
  return { byPayment, dangling: rows.filter((r) => r.lineRef && r.lineRef.startsWith('line:reservation_custom_options:') && !refs.has(r.lineRef)) };
};
const journal = (id) => {
  const [y, mo] = row(id).balancePaidDate.split('-');
  return acct.create(db).encaissementsByMonth({ month: Number(mo), year: Number(y) }).filter((e) => Number(e.reservationId ?? e.id) === id)
    .map((e) => ({ kind: e.kind, ttc: e.encaissementTtc, fraction: e.fraction, buckets: (e.buckets || []).map((b) => [b.name, b.ttc ?? null, b.ht, b.vat]) }));
};
const splits = (id) => (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'receipt_line_splits'").get()
  ? db.prepare('SELECT paidDate, linesJson FROM receipt_line_splits WHERE reservationId = ? ORDER BY paidDate').all(id) : []);

const MOMENTS = { beforeArrival: { offset: -3, checkIn: 0 }, started: { offset: 1, checkIn: 1 } };
const at = (t, id, offset) => { t.mock.timers.reset(); t.mock.timers.enable({ apis: ['Date'], now: new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T12:00:00`).getTime() }); };

// A stay with « Bois » 15 € typed and saved, optionally discounted 2 €, its solde then ticked paid ten days before the arrival.
function paidStay(t, { discountCents, readsSaleLines }) {
  const id = stay(20);
  if (readsSaleLines) db.prepare('UPDATE reservations SET readsSaleLines = 1 WHERE id = ?').run(id);
  at(t, id, -10);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), customOptions: [{ customKey: 'k1', description: 'Bois', amount: 15, newLine: true }] }, { now: new Date() }).status, 200);
  if (discountCents) assert.equal(changeLine(id, `custom:${lines(id)[0].lineId}`, { discount: { amount: discountCents / 100 } }, { now: new Date() }).status, 200);
  const paid = applyPaymentMark({ reservationId: id, body: { balancePaid: true, balancePaidDate: addDaysToIsoDate(row(id).startDate, -10), balancePaidMethod: 'transfer' }, user: { role: 'admin', id: 1 } });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  return id;
}

for (const [moment, m] of Object.entries(MOMENTS)) {
  for (const gesture of ['kept', 'retyped']) {
    for (const discountCents of [0, 200]) {
      for (const readsSaleLines of [0, 1]) {
        test(`${moment} × ${gesture} × discount ${discountCents} × readsSaleLines ${readsSaleLines}: the books of the paid solde do not move`, { skip: skipWithout(['accounting-export']) }, (t) => {
          try {
            const id = paidStay(t, { discountCents, readsSaleLines });
            const before = { alloc: allocations(id), journal: journal(id), splits: splits(id) };
            at(t, id, m.offset);
            db.prepare('UPDATE reservations SET checkInDone = ? WHERE id = ?').run(m.checkIn, id);
            const stored = lines(id)[0];
            const form = gesture === 'kept'
              ? [{ customKey: String(stored.id), customOptionId: stored.id, description: 'Bois', amount: 15 }]
              : [{ customKey: 'custom_999', description: 'Bois', amount: 15 }];
            const res = ctrl.performUpdate(id, { ...storedBody(id), customOptions: FQ.customOptionsPayload(form, new Set()) }, { now: new Date() });
            assert.equal(res.status, 200, JSON.stringify(res.body));
            const after = { alloc: allocations(id), journal: journal(id), splits: splits(id) };
            assert.deepEqual(after.alloc.byPayment, before.alloc.byPayment, 'each payment keeps its allocated total');
            assert.deepEqual(after.alloc.dangling, [], 'no allocation names a line that is gone');
            assert.deepEqual(after.journal, before.journal, 'the paid solde journal entry is identical');
            assert.deepEqual(after.splits, before.splits, 'the frozen receipt split is unchanged');
            assert.equal(lines(id)[0].lineId === stored.lineId, gesture === 'kept', 'kept = its row, retyped = a new row');
          } finally { t.mock.timers.reset(); }
        });
      }
    }
  }
}

for (const [moment, m] of Object.entries(MOMENTS)) {
  test(`${moment}: a line paid by a note, removed and retyped in one save → 409 LINE_PAID, nothing written`, (t) => {
    try {
      const id = stay(20);
      at(t, id, m.offset);
      db.prepare('UPDATE reservations SET checkInDone = ? WHERE id = ?').run(m.checkIn, id);
      assert.equal(ctrl.performUpdate(id, { ...storedBody(id), customOptions: [{ customKey: 'k1', description: 'Bois', amount: 15, newLine: true }] }, { now: new Date() }).status, 200);
      db.prepare('UPDATE reservations SET midStaySettledNotes = ? WHERE id = ?').run(JSON.stringify([{ id: 'n1', lines: [{ key: 'custom:bois', amount: 15 }] }]), id);
      const before = lines(id);
      const res = ctrl.performUpdate(id, { ...storedBody(id), customOptions: FQ.customOptionsPayload([{ customKey: 'custom_999', description: 'Bois', amount: 15 }], new Set()) }, { now: new Date() });
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'LINE_PAID');
      assert.deepEqual(lines(id), before);
    } finally { t.mock.timers.reset(); }
  });
}
