/**
 * What a VAT-registered install must keep answering byte for byte (specs/vat-optional-mode.md rule 23).
 * Not a test file: the golden test runs it on the fixture, `scripts/vat-regime-golden-prod.mjs` on a
 * copy of a real database.
 *
 * Every artefact a VAT reader feeds is captured through the real entry point: the engine quote of each
 * stay and devis, the fiche payload (stored summary, refund register), the devis PDF, the payment-link
 * baskets, the accounting journal of every month, the finance payloads, the tourist-tax page, and the
 * cancellation of every direct stay (rolled back). The caller sets `DB_PATH` and freezes the clock first.
 */

const crypto = require('crypto');

// Timestamps SQLite stamps with the real clock say nothing about a VAT reader. `vatRegime`,
// `vatPeriodId` and `showHt` are what the regime ADDED to the payloads (rule 23 compares what already existed; the
// new keys have their own suites).
const VOLATILE = new Set(['createdAt', 'updatedAt', 'cancelledAt', 'vatRegime', 'vatPeriodId', 'showHt']);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    if (Buffer.isBuffer(value)) return JSON.stringify(`buffer:${value.length}`);
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined && !VOLATILE.has(k)).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = () => res;
  res.end = (buf) => { res.body = buf; return res; };
  return res;
}

function monthsBetween(first, last) {
  const out = [];
  for (let y = first; y <= last; y += 1) for (let m = 1; m <= 12; m += 1) out.push({ year: y, month: m });
  return out;
}

/**
 * @returns {Promise<Record<string,string>>} one canonical string per captured artefact, keyed
 * `<section>/<id or month>[/<variant>]`. An artefact that throws is captured as its error message.
 */
async function capture(db, { years = [2025, 2026, 2027, 2028] } = {}) {
  const out = {};
  const put = async (key, fn) => {
    try { out[key] = canonical(await fn()); } catch (err) { out[key] = `ERROR ${err.message}`; }
  };

  const { calculateReservationQuote } = require('../utils/pricing');
  const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
  const reservationsController = require('../controllers/reservationsController');
  const devisModel = require('../models/devisModel');
  const settingsModel = require('../models/settingsModel');
  const { generateDevisPdf } = require('../utils/devisPdf');
  const payments = require('../controllers/paymentsController').__test;
  const publicPayment = require('../utils/publicPaymentMode');
  const devisQuote = require('../utils/devisQuote');
  const { buildVatItems } = require('../utils/paymentLinkItems');
  const finance = require('../models/financeModel');
  const dashboard = require('../models/financeDashboardModel');
  const installments = require('../models/installmentsModel');

  const rows = db.prepare('SELECT id, kind, platform FROM reservations ORDER BY id').all();
  const stays = rows.filter((r) => r.kind === 'reservation' || r.kind === 'cancelled');

  for (const r of rows) {
    const full = db.prepare('SELECT * FROM reservations WHERE id = ?').get(r.id);
    await put(`quote/${r.id}`, () => calculateReservationQuote(buildReservationEngineInput(db, full)));
  }

  for (const r of stays) {
    await put(`fiche/${r.id}`, () => {
      const res = fakeRes();
      reservationsController.getById({ params: { id: r.id }, user: { id: 1, roles: ['admin'], role: 'admin' } }, res);
      const b = res.body || {};
      return {
        status: res.statusCode,
        storedSummary: b.storedSummary,
        refunds: b.refunds,
        refundableLines: b.refundableLines,
        refundTotals: b.refundTotals,
        collectedTtc: b.collectedTtc,
      };
    });
  }

  for (const r of rows.filter((x) => x.kind === 'devis')) {
    await put(`pdf/${r.id}`, async () => {
      const calls = [];
      const PDFDocument = require('pdfkit');
      const realText = PDFDocument.prototype.text;
      PDFDocument.prototype.text = function patched(text, ...rest) {
        calls.push(String(text));
        return realText.call(this, text, ...rest);
      };
      try {
        const full = devisModel.findById(r.id);
        const quote = devisModel.recomputeQuote(r.id);
        const bytes = await generateDevisPdf(full, settingsModel.read(), quote);
        return { text: calls, bytes: sha(bytes.toString('latin1')) };
      } finally {
        PDFDocument.prototype.text = realText;
      }
    });
  }

  const linkTypes = ['deposit', 'balance', 'full', 'complement'];
  const itemsOf = (basket) => (basket ? { basket, items: buildVatItems(basket) } : null);
  for (const r of stays.filter((x) => x.kind === 'reservation')) {
    for (const type of linkTypes) {
      await put(`link/${r.id}/${type}`, () => ({
        viaQuote: itemsOf(payments.resolveVatComponents(r.id, type)),
        stored: itemsOf(payments.storedReservationComponents(r.id, type)),
      }));
    }
    const plan = installments.listFor(r.id);
    for (const installment of plan) {
      await put(`link/${r.id}/installment-${installment.number}`, () => itemsOf(payments.resolveInstallmentComponents(r.id, installment, plan)));
    }
  }
  for (const r of rows.filter((x) => x.kind === 'devis')) {
    await put(`link/${r.id}/public-full`, () => itemsOf(devisQuote.fullPaymentComponents({ database: db, devisModel, calc: calculateReservationQuote }, r.id)));
    await put(`link/${r.id}/public-deposit`, () => itemsOf(publicPayment.depositPaymentComponents(db, r.id)));
  }

  const { create: createAccountingModel } = require('../plugins/accounting-export/accountingModel');
  const { buildRows } = require('../plugins/accounting-export/accountingExport');
  const accounting = createAccountingModel(db);
  for (const { year, month } of monthsBetween(years[0], years[years.length - 1])) {
    await put(`csv/${year}-${String(month).padStart(2, '0')}`, () => {
      const entries = [
        ...accounting.encaissementsByMonth({ month, year }),
        ...accounting.refundsByMonth({ month, year }),
        ...accounting.compensationsByMonth({ month, year }),
      ].sort((a, b) => String(a.paidDate || '').localeCompare(String(b.paidDate || '')));
      return { entries, rows: buildRows(entries) };
    });
  }

  for (const fiscalYear of years) {
    await put(`finance/summary/${fiscalYear}`, () => finance.getSummary({ fiscalYear }));
    await put(`finance/dashboard/${fiscalYear}`, () => dashboard.getDashboard({ fiscalYear }));
    for (const tile of ['collected', 'toCollect', 'late', 'stays', 'properties', 'channels']) {
      await put(`finance/detail/${fiscalYear}/${tile}`, () => dashboard.getDashboardDetail(tile, { fiscalYear }));
    }
  }
  await put('finance/operational', () => finance.getOperational({}));
  await put('finance/projection', () => finance.getProjection({}));
  await put('finance/paceStays', () => finance.getPaceStays({}));
  for (const { year, month } of monthsBetween(years[0], years[years.length - 1])) {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    await put(`tourist-tax/${monthKey}`, () => finance.getTouristTaxExtraction({ month: monthKey }));
  }

  const { cancel } = require('../controllers/reservationCancellationController');
  for (const r of stays.filter((x) => x.kind === 'reservation' && String(x.platform || 'direct').toLowerCase() === 'direct')) {
    await put(`cancel/${r.id}`, async () => {
      db.exec('BEGIN');
      try {
        const res = fakeRes();
        await cancel({ params: { id: r.id }, body: {}, user: { id: 1 } }, res);
        const refunds = db.prepare('SELECT id FROM reservation_refunds WHERE reservationId = ? ORDER BY id').all(r.id)
          .map((h) => require('../models/refundsModel').getById(h.id));
        const comps = db.prepare('SELECT * FROM cancellation_compensations WHERE reservationId = ? ORDER BY id').all(r.id);
        return { status: res.statusCode, body: res.body, refunds, comps };
      } finally {
        db.exec('ROLLBACK');
      }
    });
  }

  return out;
}

module.exports = { capture, canonical, sha };
