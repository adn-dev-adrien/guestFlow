// specs/vat-optional-mode.md rule 8 — one resolver. No code outside vatRegimeModel reads the settings
// column, and each reader of the rate answers the period of the row it works on: on a database with
// two periods (10 % for the stays before 2027-08-01, 20 % from then on) every one of them gives the
// right rate to a stay of each side.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
// The fixture's devis expired on 2027-06-30 / 07-15; a live offer is what these suites are about (rule 25).
db.prepare("UPDATE reservations SET validUntil = '2027-12-31' WHERE kind = 'devis'").run();
db.prepare("INSERT INTO vat_periods (regime, rate, basis, effectiveFrom) VALUES ('subject', 20, 'arrival', '2027-08-01')").run();
db.prepare("UPDATE reservations SET vatPeriodId = 2 WHERE startDate >= '2027-08-01' AND kind != 'devis'").run();

// 101 (July) is sold at 10 %, 104 (August, L'Estiva), 102 (October) and 108 (September) at 20 %.
const OLD = 101;
const NEW = 104;

const { calculateReservationQuote } = require('../utils/pricing');
const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const reservationsController = require('../controllers/reservationsController');
const refundsController = require('../controllers/refundsController');
const payments = require('../controllers/paymentsController').__test;
const devisQuote = require('../utils/devisQuote');
const publicPayment = require('../utils/publicPaymentMode');
const devisModel = require('../models/devisModel');
const finance = require('../models/financeModel');
const vatRegimeModel = require('../models/vatRegimeModel');
const { create: createAccountingModel } = require('../plugins/accounting-export/accountingModel');

const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const quoteOf = (id) => calculateReservationQuote(buildReservationEngineInput(db, row(id)));

test('rule 8: no code outside vatRegimeModel reads the VAT rate from the settings', () => {
  const root = path.join(__dirname, '..');
  const allowed = new Set(['models/vatRegimeModel.js', 'utils/vatRegimeMigration.js', 'database.js', 'models/settingsModel.js']);
  const offenders = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'tests' && e.name !== 'node_modules') walk(full); return; }
    if (!e.name.endsWith('.js')) return;
    const rel = path.relative(root, full);
    if (allowed.has(rel)) return;
    const source = fs.readFileSync(full, 'utf8');
    if (/vatRate[^\n]*FROM app_settings|FROM app_settings[^\n]*\bvatRate\b|\bsettings\??\.vatRate\b|read\(\)\.vatRate|\bcore\.vatRate\b/.test(source)) offenders.push(rel);
  });
  walk(root);
  assert.deepEqual(offenders, []);
});

test('rule 8: the quote engine prices a stay at the rate of its own period', () => {
  const old = quoteOf(OLD);
  const next = quoteOf(NEW);
  assert.equal(old.vatPercentageAccommodation, 10);
  assert.equal(next.vatPercentageAccommodation, 20);
  assert.equal(old.vatRegime.periodId, 1);
  assert.equal(next.vatRegime.periodId, 2);
  assert.equal(next.accommodationVatAmount, Math.round((next.accommodationAdjustedPrice * 20 / 120) * 100) / 100);
});

test('rule 8: the proportional tourist tax bases itself on the HT of the stay\'s own rate', () => {
  const next = quoteOf(NEW);
  assert.equal(next.touristTaxMode, 'percentage_accommodation');
  const ttc = next.touristTaxAccommodationPaid;
  assert.ok(Math.abs(next.touristTaxBaseHt - ttc / 1.2) < 0.05, `${next.touristTaxBaseHt} vs ${ttc / 1.2}`);
});

test('rule 8: the stored summary reads the rate of the fiche', () => {
  const summaryOf = (id) => {
    let body;
    reservationsController.getById({ params: { id }, user: { id: 1, roles: ['admin'], role: 'admin' } }, { json: (b) => { body = b; }, status() { return this; } });
    return body.storedSummary;
  };
  assert.equal(summaryOf(OLD).vatRate, 10);
  assert.equal(summaryOf(NEW).vatRate, 20);
});

test('rule 8: the refund register offers lines at the rate of the stay', () => {
  const rateOfAccommodation = (id) => refundsController.buildRegister(id).payload.refundableLines.find((l) => l.bucket === 'accommodation').vatRate;
  assert.equal(rateOfAccommodation(OLD), 10);
  assert.equal(rateOfAccommodation(NEW), 20);
});

test('rule 8: the cancellation requalifies the acompte at the rate of the stay', async () => {
  const { cancel } = require('../controllers/reservationCancellationController');
  db.prepare("UPDATE reservations SET depositPaid = 1, depositPaidDate = '2027-06-01', depositAmount = 300 WHERE id = 108").run();
  db.exec('BEGIN');
  try {
    await cancel({ params: { id: 108 }, body: {}, user: { id: 1 } }, { status() { return this; }, json() {} });
    const lines = db.prepare('SELECT l.bucket, l.vatRate FROM reservation_refund_lines l JOIN reservation_refunds r ON r.id = l.refundId WHERE r.reservationId = 108').all();
    const taxed = lines.filter((l) => l.bucket !== 'touristTax');
    assert.ok(taxed.length > 0);
    assert.ok(taxed.every((l) => l.vatRate === 20), JSON.stringify(taxed));
  } finally {
    db.exec('ROLLBACK');
  }
});

test('rule 8: the payment-link baskets of a stay and of an installment carry the rate of the stay', () => {
  assert.equal(payments.storedReservationComponents(OLD, 'balance').vatRatePercent, 10);
  assert.equal(payments.storedReservationComponents(NEW, 'balance').vatRatePercent, 20);
  db.prepare('UPDATE reservations SET vatPeriodId = 2 WHERE id = 106').run();
  const installments = require('../models/installmentsModel');
  const plan = installments.listFor(106);
  assert.equal(payments.resolveInstallmentComponents(106, plan[0], plan).vatRatePercent, 20);
  db.prepare('UPDATE reservations SET vatPeriodId = 1 WHERE id = 106').run();
  assert.equal(payments.resolveInstallmentComponents(106, plan[0], plan).vatRatePercent, 10);
});

test('rule 8: the public payment of a devis carries the rate it is quoted under', () => {
  const calc = calculateReservationQuote;
  const full = devisQuote.fullPaymentComponents({ database: db, devisModel, calc }, 202);
  assert.equal(full.vatRatePercent, 20);
  assert.equal(publicPayment.depositPaymentComponents(db, 202).vatRatePercent, 20);
});

test('rule 8: the finance HT figures use the rate of each stay', () => {
  const { totalSejour, htAmount } = finance.helpers;
  const before = finance.getSummary({ fiscalYear: 2027 }).yearTotalHt;
  db.prepare('UPDATE reservations SET vatPeriodId = 1 WHERE id = ?').run(NEW);
  const asOld = finance.getSummary({ fiscalYear: 2027 }).yearTotalHt;
  db.prepare('UPDATE reservations SET vatPeriodId = 2 WHERE id = ?').run(NEW);
  const stay = totalSejour(row(NEW));
  const expectedDelta = Math.round((htAmount(row(NEW), stay, 10) - htAmount(row(NEW), stay, 20)) * 100) / 100;
  assert.ok(expectedDelta > 0);
  assert.equal(Math.round((asOld - before) * 100) / 100, expectedDelta);
});

test('rule 8: the devis PDF prints the rate of the regime the devis is quoted under', async () => {
  const { generateDevisPdf } = require('../utils/devisPdf');
  const PDFDocument = require('pdfkit');
  const realText = PDFDocument.prototype.text;
  const printed = [];
  PDFDocument.prototype.text = function patched(text, ...rest) { printed.push(String(text)); return realText.call(this, text, ...rest); };
  try {
    await generateDevisPdf(devisModel.findById(202), require('../models/settingsModel').read(), devisModel.recomputeQuote(202));
  } finally {
    PDFDocument.prototype.text = realText;
  }
  assert.ok(printed.includes('20,00%'), printed.filter((t) => t.includes('%')).join(' | '));
  assert.ok(!printed.includes('10,00%'));
});

test('rule 8: the accounting journal books each entry at the rate of its reservation', () => {
  const accounting = createAccountingModel(db);
  const rateOf = (month, id) => accounting.encaissementsByMonth({ month, year: 2027 })
    .filter((e) => e.reservationId === id).flatMap((e) => e.buckets).map((b) => b.ratePercent);
  assert.deepEqual([...new Set(rateOf(8, NEW))], [20]);
  assert.deepEqual([...new Set(rateOf(6, OLD))], [10]);
});

test('rule 8: the regime in force today and the regime of a row are two answers', () => {
  assert.equal(vatRegimeModel.inForceBlock(db).rate, 20);
  assert.equal(vatRegimeModel.forRow(db, null).rate, 20);
  assert.equal(vatRegimeModel.forRow(db, { id: NEW }).rate, 20);
  assert.equal(vatRegimeModel.forRow(db, row(OLD)).rate, 10);
});
