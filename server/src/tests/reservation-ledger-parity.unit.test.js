// specs/reservation-payment-ledger.md §7 — parity of the ledger with the money readers that already
// exist (rules 1, 4 and 5): for every stored reservation, each bucket's paid / unpaid state and amount
// in the ledger equals `reservationSettlement.bucketStates`, the ledger's « Reste à percevoir » equals
// `remainingToPay`, and building every ledger leaves the accounting export byte-identical.
//
// Run on a neutralised copy of the Solio base by pointing LEDGER_PARITY_DB at it — the file is copied
// first, the copy is what the migrations touch, the source is never opened for writing:
//   LEDGER_PARITY_DB=/path/to/solio.db node --test src/tests/reservation-ledger-parity.unit.test.js
// Without it (CI), the same checks run on a synthetic base that walks every bucket state.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SOURCE = process.env.LEDGER_PARITY_DB || '';
if (SOURCE) {
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-parity-')), 'copy.db');
  fs.copyFileSync(SOURCE, copy);
  process.env.DB_PATH = copy;
} else {
  process.env.DB_PATH = ':memory:';
}

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, controller, respond, createStay, mark, ADMIN } = require('./ledgerFixture');
const { bucketStates, remainingToPay } = require('../utils/reservationSettlement');
const { create: createAccountingModel } = require('../plugins/accounting-export/accountingModel');
const { create: createAccountingController } = require('../plugins/accounting-export/controller');

function seedSynthetic() {
  const today = new Date().toISOString().slice(0, 10);
  const due = createStay();
  const depositPaid = createStay();
  mark(depositPaid, { depositPaid: true, depositPaidDate: today });
  const bothPaid = createStay();
  mark(bothPaid, { depositPaid: true, depositPaidDate: today });
  mark(bothPaid, { balancePaid: true, balancePaidDate: today });
  const noDeposit = createStay({ depositDisabled: 1 });
  mark(noDeposit, { balancePaid: true, balancePaidDate: today });
  const booking = createStay({ platform: 'Booking', platformCommissionAmount: 46.08 });
  const bookingPaid = createStay({ platform: 'Booking', platformCommissionAmount: 46.08 });
  mark(bookingPaid, { balancePaid: true, balancePaidDate: today });
  const complement = createStay();
  db.prepare('UPDATE reservations SET complementAmount = 24, endOfStayComplementAmount = 12 WHERE id = ?').run(complement);
  mark(complement, { complementPaidCash: true });
  const deferred = createStay();
  db.prepare('UPDATE reservations SET complementAmount = 24, endOfStayComplementAmount = 12, complementDeferredToCheckout = 1 WHERE id = ?').run(deferred);
  const caution = createStay();
  mark(caution, { cautionReceived: true, cautionReceivedDate: today });
  const cancelled = createStay();
  mark(cancelled, { depositPaid: true, depositPaidDate: today });
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(cancelled);
}

function exportAll() {
  const accounting = createAccountingController(createAccountingModel(db));
  const months = db.prepare(`
    SELECT DISTINCT substr(d, 1, 7) AS ym FROM (
      SELECT depositPaidDate AS d FROM reservations UNION SELECT balancePaidDate FROM reservations
      UNION SELECT complementPaidDate FROM reservations UNION SELECT endOfStayComplementPaidDate FROM reservations
      UNION SELECT endDate FROM reservations
    ) WHERE d IS NOT NULL AND d <> '' ORDER BY ym
  `).all().map((r) => r.ym);
  const chunks = [];
  for (const ym of months) {
    const [year, month] = ym.split('-').map(Number);
    let sent = null;
    const res = { setHeader() {}, status() { return res; }, json(b) { sent = Buffer.from(JSON.stringify(b)); return res; }, send(b) { sent = b; return res; } };
    accounting.salesCsv({ query: { year, month } }, res);
    chunks.push(Buffer.from(`${ym}\n`), sent || Buffer.alloc(0));
  }
  return Buffer.concat(chunks);
}

function ledgerOf(id) {
  const res = respond();
  controller.getById({ params: { id: String(id) }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.ledger;
}

const isPaid = (row) => Boolean(row) && String(row.state).startsWith('paid');

test('rules 1, 4, 5 — every stored reservation: bucket states, amounts and « Reste à percevoir » match the settlement readers; the export is untouched', () => {
  if (!SOURCE) seedSynthetic();
  const before = exportAll();
  const rows = db.prepare("SELECT * FROM reservations WHERE kind IN ('reservation', 'cancelled') ORDER BY id").all();
  assert.ok(rows.length > 0, 'something to compare');
  const mismatches = [];
  for (const r of rows) {
    const ledger = ledgerOf(r.id);
    const b = bucketStates(r);
    const byKey = Object.fromEntries(ledger.rows.map((row) => [row.key, row]));
    const check = (what, ok) => { if (!ok) mismatches.push(`#${r.id} ${what}`); };

    // Acompte: applicable → same amount, same settled state; not applicable → « Sans objet » or a 0 € row.
    const dep = byKey.deposit;
    if (b.deposit.applicable) {
      check(`deposit amount ${dep && dep.amount} ≠ ${b.deposit.amount}`, dep && dep.amount === b.deposit.amount);
      check('deposit settled', isPaid(dep) === b.deposit.settled);
    } else {
      check('deposit not applicable', dep && (dep.state === 'na' || dep.amount === 0 || r.depositDisabled));
    }
    const bal = byKey.balance;
    check(`balance amount ${bal && bal.amount} ≠ ${b.balance.amount}`, bal && bal.amount === b.balance.amount);
    check('balance settled', isPaid(bal) === b.balance.settled || (!b.balance.applicable && !isPaid(bal)));

    const deferred = Number(r.complementDeferredToCheckout || 0) === 1;
    if (deferred && (b.complement.applicable || b.endOfStay.applicable)) {
      const merged = byKey.checkoutComplement;
      check('deferred complement row', merged && merged.amount === Math.round((b.complement.amount + b.endOfStay.amount) * 100) / 100);
      check('deferred complement settled', isPaid(merged) === b.complement.settled);
    } else {
      if (b.complement.applicable) {
        check('complement amount', byKey.complement && byKey.complement.amount === b.complement.amount);
        check('complement settled', isPaid(byKey.complement) === b.complement.settled);
      }
      if (b.endOfStay.applicable) {
        check('end-of-stay amount', byKey.endOfStayComplement && byKey.endOfStayComplement.amount === b.endOfStay.amount);
        check('end-of-stay settled', isPaid(byKey.endOfStayComplement) === b.endOfStay.settled);
      }
    }
    check(`remaining ${ledger.remaining} ≠ ${remainingToPay(r)}`, ledger.remaining === remainingToPay(r));
  }
  assert.deepEqual(mismatches, []);

  const after = exportAll();
  assert.ok(before.equals(after), 'the accounting export is byte-identical after every ledger was built');
  // eslint-disable-next-line no-console
  console.log(`[ledger-parity] ${SOURCE ? 'copy of the given base' : 'synthetic base'}: ${rows.length} reservation(s), export ${before.length} bytes`);
});
