/**
 * Accounting controller — orchestrates the monthly sales CSV export and the platform-commission
 * preview. Thin: delegates to accountingModel (data), accountingExport (engine) and the core CSV
 * serializer. Accessible to both admins and the read-only accountant role.
 */

const sdk = require('../sdk');
const { csvJournal, salesJson } = require('./accountingExport');

const { journalEntries } = sdk.coreModule('accountingOutput');

function parseMonthYear(query) {
  const month = Number(query.month);
  const year = Number(query.year);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(year) || year < 2000 || year > 9999) return null;
  return { month, year };
}

// Sales + refunds + cancellation compensations of the month, in one chronological stream (the core's `journalEntries`):
// the CSV and the JSON preview can never drift apart.
function monthEntries(accountingModel, params) {
  return journalEntries(params, accountingModel);
}


// `plan()` — the account plan of the export (specs/plugins-phase-p-productisation.md rule 27); none
// means the defaults.
// `onCsvExported(month, req)` — specs/accounting-synthesis.md rules 16 and 40: the download is stamped once its file is built.
function createAccountingController(accountingModel, { plan = () => undefined, onCsvExported = () => {} } = {}) {
  return {
    salesCsv(req, res) {
      const params = parseMonthYear(req.query);
      if (!params) return res.status(400).json({ error: 'INVALID_MONTH_OR_YEAR' });
      const entries = monthEntries(accountingModel, params);
      const file = csvJournal.export(entries, { plan: plan(), period: params });
      onCsvExported(`${params.year}-${String(params.month).padStart(2, '0')}`, req);
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      return res.send(file.body);
    },

    // JSON mirror of the CSV — same encaissements, same lines, but grouped per entry and pre-classified
    // (client / revenue / vat) so the UI can render the journal as cards. The strict guarantee: every row
    // in the CSV appears as exactly one `line` in the JSON.
    salesJson(req, res) {
      const params = parseMonthYear(req.query);
      if (!params) return res.status(400).json({ error: 'INVALID_MONTH_OR_YEAR' });
      const entries = monthEntries(accountingModel, params);
      return res.json(salesJson.export(entries, { plan: plan() }).body);
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

module.exports = {
  create: createAccountingController,
  monthEntries,
  __test: { parseMonthYear, monthEntries, taxOnlyEntries: salesJson.__test.taxOnlyEntries },
};
