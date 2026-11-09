// specs/mixed-method-payments.md rules 12, 19, 31 — the other targets of a split payment and what the fiche shows of
// them: an installment paid with several methods is recorded as 'mixed'; a geste commercial is shown under its
// settlement; the « Notes en séjour » row carries the lines of a note settled that way.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const installmentsController = require('../controllers/installmentsController');
const installmentsModel = require('../models/installmentsModel');
const settlements = require('../models/paymentSettlementsModel');
const { buildLedger } = require('../utils/reservationLedger');
const { getTodayIsoDate } = require('../utils/reservationHelpers');

const TODAY = getTodayIsoDate();
// The app writes a non-breaking space before « € ».
const plain = (text) => String(text).replace(/\s/g, ' ');
db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (1, 'Gîte', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();

const call = (handler, params, body) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  handler({ params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), body, user: { id: 1, role: 'admin' } }, res);
  return res;
};

test('specs/mixed-method-payments.md rule 12 — an installment paid with several methods is recorded as mixed', () => {
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice)
    VALUES (1, 1, date(?, '+60 day'), date(?, '+65 day'), 'direct', 2, 600)`).run(TODAY, TODAY).lastInsertRowid);
  const [first] = installmentsModel.replacePlan(id, [
    { number: 1, dueDate: TODAY, amountCents: 30000 },
    { number: 2, dueDate: TODAY, amountCents: 30000 },
  ], 60000);
  const res = call(installmentsController.markPaid, { id, installmentId: first.id }, {
    paidDate: TODAY, tenders: [{ method: 'cheque', amountCents: 20000 }, { method: 'cash', amountCents: 10000, internal: true }],
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(installmentsModel.findById(first.id).paidMethod, 'mixed');
  const [s] = settlements.listFor(id);
  assert.equal(s.targetKind, 'installment');
  assert.equal(db.prepare('SELECT splitOffBooksAmount FROM reservations WHERE id = ?').get(id).splitOffBooksAmount, 100);
});

const ROW = {
  id: 9, kind: 'reservation', platform: 'direct', startDate: '2026-11-03', endDate: '2026-11-08', finalPrice: 720,
  depositAmount: 0, balanceAmount: 720, balancePaid: 1, balancePaidDate: '2026-11-03',
  endOfStayComplementAmount: 122, endOfStayComplementPaid: 1, endOfStayComplementPaidDate: '2026-11-08',
};

test('specs/mixed-method-payments.md rule 19 — the geste commercial is shown under its settlement', () => {
  const ledger = buildLedger({
    row: ROW,
    today: TODAY,
    settlements: [{
      id: 1, targetKind: 'bucket', targetKey: 'endOfStayComplement', paidDate: '2026-11-08', dueCents: 12200,
      shortfallCents: 800, shortfallKind: 'waived',
      parts: [{ kind: 'endOfStayComplement', key: 'endOfStayComplement', amountCents: 12200 }],
      tenders: [{ method: 'cash', amountCents: 5000, internal: 1 }, { method: 'card', amountCents: 6400, internal: 0 }],
    }],
  });
  const row = ledger.rows.find((r) => r.key === 'endOfStayComplement');
  assert.equal(plain(row.split.settlements[0].shortfall.label), 'Geste commercial 8,00 €');
  assert.deepEqual(row.split.settlements[0].lines.map((l) => plain(l.label)), ['Espèces 50,00 €', 'CB 64,00 €']);
  assert.equal(row.split.remainder, null);
  assert.match(row.stateLabel, /plusieurs moyens/);
});

test('specs/mixed-method-payments.md rule 31 — the « Notes en séjour » row carries the lines of a note settled that way', () => {
  const note = { id: 'n1', paidDate: '2026-11-05', paidCash: 0, total: 30, lines: [] };
  const ledger = buildLedger({
    row: { ...ROW, midStaySettledNotes: JSON.stringify([note]) },
    midStayNotes: [note],
    today: TODAY,
    settlements: [{
      id: 2, targetKind: 'midStayNote', targetKey: 'n1', paidDate: '2026-11-05', dueCents: 3000, shortfallCents: 0, shortfallKind: null,
      parts: [{ kind: 'note', key: 'n1', amountCents: 3000 }],
      tenders: [{ method: 'cash', amountCents: 1000, internal: 1 }, { method: 'card', amountCents: 2000, internal: 0 }],
    }],
  });
  const row = ledger.rows.find((r) => r.key === 'midStayNotes');
  assert.ok(row, 'the notes row');
  assert.deepEqual(row.split.settlements[0].lines.map((l) => [plain(l.label), l.internal]), [['Espèces 10,00 €', true], ['CB 20,00 €', false]]);
});
