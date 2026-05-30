/**
 * Accounting controller — orchestrates the monthly sales CSV export and the platform-commission
 * preview. Thin: delegates to accountingModel (data), utils/accountingExport (engine) and utils/csv
 * (serializer). Accessible to both admins and the read-only accountant role.
 */

const defaultAccountingModel = require('../models/accountingModel');
const { buildRows, buildStructuredEntries, CSV_HEADERS } = require('../utils/accountingExport');
const { serializeCsv } = require('../utils/csv');

function parseMonthYear(query) {
  const month = Number(query.month);
  const year = Number(query.year);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(year) || year < 2000 || year > 9999) return null;
  return { month, year };
}

function createAccountingController(accountingModel) {
  return {
    salesCsv(req, res) {
      const params = parseMonthYear(req.query);
      if (!params) return res.status(400).json({ error: 'INVALID_MONTH_OR_YEAR' });
      const entries = accountingModel.encaissementsByMonth(params);
      const rows = buildRows(entries);
      const csv = serializeCsv(CSV_HEADERS, rows);
      const mm = String(params.month).padStart(2, '0');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ventes-${params.year}-${mm}.csv"`);
      return res.send(csv);
    },

    // JSON mirror of the CSV — same encaissements, same lines, but grouped per entry and pre-classified
    // (client / revenue / vat) so the UI can render the journal as cards. The strict guarantee: every row
    // in the CSV appears as exactly one `line` in the JSON.
    salesJson(req, res) {
      const params = parseMonthYear(req.query);
      if (!params) return res.status(400).json({ error: 'INVALID_MONTH_OR_YEAR' });
      const entries = accountingModel.encaissementsByMonth(params);
      const structured = buildStructuredEntries(entries);
      const totalDebits = structured.reduce((s, e) => s + e.sumDebits, 0);
      const totalCredits = structured.reduce((s, e) => s + e.sumCredits, 0);
      return res.json({
        entries: structured,
        totals: {
          entriesCount: structured.length,
          totalDebits: Math.round(totalDebits * 100) / 100,
          totalCredits: Math.round(totalCredits * 100) / 100,
          allBalanced: structured.every((e) => e.balanced),
        },
      });
    },

    // JSON preview of the platform commissions in the month — drives the AccountingPage table.
    platformsPreview(req, res) {
      const params = parseMonthYear(req.query);
      if (!params) return res.status(400).json({ error: 'INVALID_MONTH_OR_YEAR' });
      const entries = accountingModel.encaissementsByMonth(params);
      const platformRows = entries
        .filter((e) => e.platform && e.platform !== 'direct')
        .map((e) => ({
          date: e.paidDate,
          kind: e.kind,
          client: `${e.client.firstName || ''} ${e.client.lastName || ''}`.trim() || `Réservation #${e.reservationId}`,
          platform: e.platform,
          gross: e.clientGrossAmount == null ? null : Number(e.clientGrossAmount),
          net: Number(e.finalPrice),
          encaissement: Number(e.encaissementTtc),
          commission: e.clientGrossAmount == null ? null : Math.max(0, Math.round((Number(e.clientGrossAmount) - Number(e.finalPrice)) * 100) / 100),
        }));
      const totalCommission = platformRows.reduce((s, r) => s + (r.commission || 0), 0);
      return res.json({ rows: platformRows, totalCommission: Math.round(totalCommission * 100) / 100 });
    },
  };
}

const defaultController = createAccountingController(defaultAccountingModel);

module.exports = defaultController;
module.exports.create = createAccountingController;
module.exports.__test = { parseMonthYear };
