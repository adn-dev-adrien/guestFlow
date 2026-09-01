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

// Sales + refunds + cancellation compensations of the month, in one chronological stream. Neither a
// refund nor a compensation is an encaissement, but both belong to the same journal at their own
// date (specs/reservation-refunds.md §3.4 rule 21, specs/cancellation-compensation.md §3.3 rule 15).
// Building the stream here means the CSV and the JSON preview can never drift apart.
function monthEntries(accountingModel, params) {
  const sales = accountingModel.encaissementsByMonth(params);
  const refunds = accountingModel.refundsByMonth ? accountingModel.refundsByMonth(params) : [];
  const compensations = accountingModel.compensationsByMonth ? accountingModel.compensationsByMonth(params) : [];
  return [...sales, ...refunds, ...compensations]
    .sort((a, b) => String(a.paidDate || '').localeCompare(String(b.paidDate || '')));
}

function createAccountingController(accountingModel) {
  return {
    salesCsv(req, res) {
      const params = parseMonthYear(req.query);
      if (!params) return res.status(400).json({ error: 'INVALID_MONTH_OR_YEAR' });
      const entries = monthEntries(accountingModel, params);
      const rows = buildRows(entries);
      // ISO-8859-1 (latin1) without BOM — matches the accountant's `Exemple export ventes
      // SOLIO.csv` byte-for-byte. French accounting software (Sage/EBP/Cegid) defaults to
      // latin1 and chokes on the UTF-8 BOM, so we drop it via `{ bom: false }` and re-encode
      // the string into a latin1 Buffer. Characters outside the latin1 range (rare for French
      // customer names) get truncated to their low byte — acceptable for the accountant
      // export's use case.
      const csv = serializeCsv(CSV_HEADERS, rows, { bom: false });
      const buffer = Buffer.from(csv, 'latin1');
      const mm = String(params.month).padStart(2, '0');
      res.setHeader('Content-Type', 'text/csv; charset=ISO-8859-1');
      res.setHeader('Content-Disposition', `attachment; filename="ventes-${params.year}-${mm}.csv"`);
      return res.send(buffer);
    },

    // JSON mirror of the CSV — same encaissements, same lines, but grouped per entry and pre-classified
    // (client / revenue / vat) so the UI can render the journal as cards. The strict guarantee: every row
    // in the CSV appears as exactly one `line` in the JSON.
    salesJson(req, res) {
      const params = parseMonthYear(req.query);
      if (!params) return res.status(400).json({ error: 'INVALID_MONTH_OR_YEAR' });
      const entries = monthEntries(accountingModel, params);
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
      // 2026-06-02: the table no longer pre-filters out direct bookings — Adrien wants every
      // encaissement of the month visible in one place. For direct bookings `gross` and
      // `commission` are `null` (rendered as `—`); `totalCommission` below still aggregates
      // only the rows where a commission is actually defined.
      const platformRows = entries
        .map((e) => ({
          // `reservationId` + `propertyName` added 2026-06-02 so the AccountingPage table can
          // link each row to its reservation file (admin only) and display the property.
          reservationId: e.reservationId,
          propertyName: e.propertyName || '',
          date: e.paidDate,
          kind: e.kind,
          client: `${e.client.firstName || ''} ${e.client.lastName || ''}`.trim() || `Réservation #${e.reservationId}`,
          platform: e.platform,
          gross: e.clientGrossAmount == null ? null : Number(e.clientGrossAmount),
          // Revenu brut (CA) = what the guest paid the platform = `encaissementTtc`. The NET (versement
          // banked by the owner) = `encaissementNetTtc` (= revenu brut − commission). Surfacing the net
          // so the operator can reconcile against the platform's bank transfer (2026-06-22).
          encaissement: Number(e.encaissementTtc),
          net: Number(e.encaissementNetTtc),
          // specs/platform-commission-line.md — the commission is the engine-computed line
          // (operator-entered `platformCommissionAmount`, or the legacy gross−net fallback inside
          // buildEntry). Read it off the entry instead of re-deriving from the gross here.
          commission: e.commission ? Math.round(Number(e.commission.ttc) * 100) / 100 : null,
          // specs/single-payment-at-check-in.md §3.3 rule 13 — la collecte à laquelle cette écriture
          // appartient. Le tableau replie les écritures d'un même paiement en UNE ligne : sans ça il
          // affichait deux encaissements pour un seul mouvement bancaire, à rebours de la carte de
          // journal juste au-dessus qui, elle, les regroupe déjà (constaté en production 2026-09-01).
          paymentGroup: e.paymentGroup || null,
        }));
      const totalCommission = platformRows.reduce((s, r) => s + (r.commission || 0), 0);
      return res.json({ rows: platformRows, totalCommission: Math.round(totalCommission * 100) / 100 });
    },
  };
}

const defaultController = createAccountingController(defaultAccountingModel);

module.exports = defaultController;
module.exports.create = createAccountingController;
module.exports.__test = { parseMonthYear, monthEntries };
