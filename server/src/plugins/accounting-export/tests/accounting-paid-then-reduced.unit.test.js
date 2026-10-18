// specs/accounting-books-the-money-collected.md rule 11 — a stay paid, then reduced (one guest fewer,
// breakfast cut) must never book a negative credit. The contribs captured at payment time described
// the bigger stay; used as-is they overflowed the entry and the export put the residue on the last
// credit, the 46710000 tourist tax: `70600000 C272.73 | 70600010 C130.91 | 44571100 C40.36 |
// 46710000 C-88.8` (review 2026-10-18, F2). Since the online payment goes through the same recorder
// as the manual tick (specs/plugins-phase-3a-online-payment.md rule 1), both paths reached it.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const { __test: { buildEntry }, create: createAccountingModel } = require('../accountingModel');
const { entryToStructured } = require('../accountingExport');

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const linesOf = (structured) => structured.lines.map((l) => `${l.compte} ${l.debit != null && l.debit !== '' ? `D${l.debit}` : `C${l.credit}`}`);

// The review's reservation after the downsize: Gîte 3 nights, solde paid online for 6 adults with
// breakfast for 6 (300 + 144 + 96 tax = 540), then saved with 2 adults and breakfast for 2.
function reducedRow(overrides = {}) {
  return {
    id: 1, firstName: 'Camille', lastName: 'Revue', platform: 'direct',
    depositAmount: 0, depositPaid: 0, depositPaidDate: null,
    balanceAmount: 355.2, balancePaid: 1, balancePaidDate: '2026-10-18',
    complementAmount: 0, complementPaid: 0,
    finalPrice: 348, totalPrice: 300, touristTaxTotal: 7.2, touristTaxInComplement: 0,
    accommodationAcompteContribTtc: 0, accommodationSoldeContribTtc: 300,
    touristTaxAcompteContribTtc: 0, touristTaxSoldeContribTtc: 96,
    clientGrossAmount: null,
    ...overrides,
  };
}
const reducedLines = (contribs) => ({
  optionLines: [{
    optionId: 6, totalPrice: 48, offered: 0, inComplement: 0,
    acompteContribTtc: contribs ? 0 : null, soldeContribTtc: contribs ? 144 : null,
  }],
  customOptionLines: [],
  resourceLines: [],
  hasContribs: contribs,
  accommodationTtcCurrent: 300,
  optionsTtc: 48,
  resourcesTtc: 0,
});

test('rule 11 — paid then reduced: no negative credit, the tax line is the current tax', () => {
  const entry = buildEntry(reducedRow(), 'balance', reducedLines(true));
  const lines = entryToStructured(entry).lines;
  for (const l of lines) assert.ok(!(Number(l.credit) < 0), `negative credit on ${l.compte}`);
  assert.deepEqual(linesOf(entryToStructured(entry)).filter((l) => l.includes(' C')).sort(), [
    '44571100 C31.63', '46710000 C7.2', '70600000 C272.73', '70600010 C43.64',
  ]);
});

test('rule 11 — the reduced stay books exactly what a stay without captured contribs books', () => {
  const withContribs = linesOf(entryToStructured(buildEntry(reducedRow(), 'balance', reducedLines(true))));
  const withoutContribs = linesOf(entryToStructured(buildEntry(reducedRow({
    accommodationSoldeContribTtc: null, accommodationAcompteContribTtc: null,
    touristTaxSoldeContribTtc: null, touristTaxAcompteContribTtc: null,
  }), 'balance', reducedLines(false))));
  assert.deepEqual(withContribs, withoutContribs);
});

test('rule 11 — contribs that still fit the entry keep driving it (no regression of the contrib path)', () => {
  const row = reducedRow({ balanceAmount: 540, finalPrice: 444, touristTaxTotal: 96 });
  const lines = { ...reducedLines(true), optionLines: [{ ...reducedLines(true).optionLines[0], totalPrice: 144 }], optionsTtc: 144 };
  const entry = buildEntry(row, 'balance', lines);
  assert.equal(entry.fraction, 1);
  const options = entry.buckets.find((b) => b.name === 'options');
  assert.equal(round2(options.ht + options.vat), 144);
});

// End to end on the real boot schema: the online payment path (recorder with
// keepPaymentOnCaptureFailure, as the poll calls it), then a save with fewer guests, then the journal.
test('rule 11 — online payment, then a reduced party: the journal stays positive and balanced', () => {
  const db = require('../../../database');
  const { recordStayPayment, depsFor } = require('../../../utils/stayPaymentRecorder');
  const controller = require('../../../controllers/reservationsController');

  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled)
              VALUES (1, 'Gîte', 8, 'per_day_per_person', 4, 0)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  const optionId = db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Petit déjeuner test', 'per_person_per_night', 8)").run().lastInsertRowid;
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(optionId);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();

  const body = (adults) => ({
    propertyId: 1, clientId: 1, startDate: '2027-01-24', endDate: '2027-01-27',
    checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
    adults, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    depositDisabled: 1, options: [{ optionId, quantity: 1 }],
  });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.create({ body: body(6), user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const id = res.body.id;

  const paid = recordStayPayment(depsFor(db), { reservationId: id, bucket: 'balance', paidDate: '2026-10-18', keepPaymentOnCaptureFailure: true });
  assert.deepEqual(paid, { flipped: ['balance'], captureFailed: [] });

  const saved = controller.performUpdate(id, { ...body(2), forceOverpayment: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const entries = createAccountingModel(db).encaissementsByMonth({ month: 10, year: 2026 })
    .filter((e) => Number(e.reservationId) === Number(id));
  assert.ok(entries.length > 0, 'the solde is in the journal');
  // specs/reservation-refunds.md rule 36 — the paid solde keeps what it collected, so the entry books
  // the tax the solde received; the trop-perçu refund then gives the excess back on 46710000.
  const row = db.prepare('SELECT balanceAmount, touristTaxSoldeContribTtc FROM reservations WHERE id = ?').get(id);
  for (const entry of entries) {
    const { lines } = entryToStructured(entry);
    for (const l of lines) assert.ok(!(Number(l.credit) < 0), `negative credit on ${l.compte}: ${l.credit}`);
    const credits = round2(lines.reduce((s, l) => s + Number(l.credit || 0), 0));
    const debits = round2(lines.reduce((s, l) => s + Number(l.debit || 0), 0));
    assert.equal(credits, debits, 'balanced');
    const tax = lines.find((l) => l.compte === '46710000');
    assert.equal(Number(tax.credit), row.touristTaxSoldeContribTtc, 'the tax line is the tax the solde collected');
  }
});
