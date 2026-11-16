/**
 * Accounting controller — orchestrates the monthly sales CSV export and the platform-commission
 * preview. Thin: delegates to accountingModel (data), accountingExport (engine) and the core CSV
 * serializer. Accessible to both admins and the read-only accountant role.
 */

const sdk = require('../sdk');
const { buildRows, buildStructuredEntries, CSV_HEADERS } = require('./accountingExport');
const { toLatin1Text } = require('./latin1');
const { MOLLIE_DEFAULTS } = require('./settings');

const { serializeCsv } = sdk.coreModule('csv');

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
function monthEntries(accountingModel, params, plan = {}) {
  const sales = accountingModel.encaissementsByMonth(params);
  const refunds = accountingModel.refundsByMonth ? accountingModel.refundsByMonth(params) : [];
  const compensations = accountingModel.compensationsByMonth ? accountingModel.compensationsByMonth(params) : [];
  const penalties = accountingModel.platformPenaltiesByMonth ? accountingModel.platformPenaltiesByMonth(params) : [];
  // specs/resource-booking-pricing-and-invoicing.md rule 21 — the sales made outside any stay.
  const standalone = accountingModel.standaloneSalesByMonth ? accountingModel.standaloneSalesByMonth(params) : [];
  return [...sales, ...refunds, ...compensations, ...penalties, ...standalone, ...mollieEntries(accountingModel, params, plan).entries]
    .sort((a, b) => String(a.paidDate || '').localeCompare(String(b.paidDate || '')));
}

const MOLLIE_KINDS = new Set(['link', 'credit', 'cost']);

/**
 * specs/mollie-rolling-reserve-and-incoming-payments.md rules 28-31 — the Mollie facts of the month as journal entries
 * (their accounts are the plan's), and what the export page shows beside them: the clearing account's balance at month
 * end (rule 30) and the credits no payment explains yet, which book nothing (rule 31). The bank lines are left out when
 * the accountant books the bank himself (rule 29).
 */
function mollieEntries(accountingModel, params, plan = {}) {
  const found = accountingModel.mollieByMonth ? accountingModel.mollieByMonth(params) : { entries: [], unattached: [], clearing: null };
  const accounts = { ...MOLLIE_DEFAULTS, ...plan };
  const withBank = String(accounts.mollieExportBank) !== '0';
  const labels = {
    [String(accounts.mollieClearingAccount)]: 'Compte d\'attente Mollie',
    [String(accounts.mollieBankAccount)]: 'Banque',
    [String(accounts.mollieFeeAccount)]: 'Frais Mollie',
  };
  const entries = found.entries.filter((e) => MOLLIE_KINDS.has(e.kind) && (withBank || e.kind !== 'credit')).map((e) => ({
    reservationId: e.reservationId == null ? null : e.reservationId, kind: 'mollie', direction: 'mollie', mollieKind: e.kind, paidDate: e.date,
    client: e.client || { firstName: '', lastName: '' }, amount: e.amountCents / 100, encaissementTtc: e.amountCents / 100,
    libelle: e.libelle || '', settlementReference: e.settlementReference || '', qontoReference: e.qontoReference || '', accountLabels: labels,
  }));
  return {
    entries,
    unattached: found.unattached.map((u) => ({ ...u, amount: u.amountCents / 100 })),
    clearing: found.clearing ? {
      account: String(accounts.mollieClearingAccount), asOf: found.clearing.asOf, balance: found.clearing.balanceCents / 100,
      clients: found.clearing.clients.map((c) => ({ ...c, balance: c.balanceCents / 100 })),
    } : null,
  };
}

const TOURIST_TAX_ACCOUNT = '46710000';
function taxOnlyEntries(structured) {
  return structured
    .filter((e) => e.direction === 'sale')
    .filter((e) => {
      const credits = (e.lines || []).filter((l) => Number(l.credit) > 0);
      return credits.length > 0 && credits.every((l) => String(l.compte) === TOURIST_TAX_ACCOUNT);
    })
    .map((e) => ({ reservationId: e.reservationId, kind: e.kind, libelle: e.libelle, paidDate: e.paidDate, amount: e.encaissementTtc }));
}

// `plan()` — the account plan of the export (specs/plugins-phase-p-productisation.md rule 27); none
// means the defaults.
// `onCsvExported(month, req)` — specs/accounting-synthesis.md rules 16 and 40: the download is stamped once its file is built.
function createAccountingController(accountingModel, { plan = () => undefined, onCsvExported = () => {} } = {}) {
  return {
    salesCsv(req, res) {
      const params = parseMonthYear(req.query);
      if (!params) return res.status(400).json({ error: 'INVALID_MONTH_OR_YEAR' });
      const entries = monthEntries(accountingModel, params, plan());
      const rows = buildRows(entries, plan());
      // ISO-8859-1 (latin1) without BOM — the « Format standard (CSV) », byte-for-byte the
      // accountant's example file. French accounting software (Sage/EBP/Cegid) defaults to
      // latin1 and chokes on the UTF-8 BOM, so we drop it via `{ bom: false }` and re-encode
      // the string into a latin1 Buffer, once every cell's characters outside latin1 (’, Œ, …) have
      // been transliterated (rule 31) — before the quoting, which a « ” » → « " » must go through.
      const latin1Rows = rows.map((row) => row.map((cell) => (typeof cell === 'string' ? toLatin1Text(cell) : cell)));
      const csv = serializeCsv(CSV_HEADERS, latin1Rows, { bom: false });
      const buffer = Buffer.from(csv, 'latin1');
      const mm = String(params.month).padStart(2, '0');
      onCsvExported(`${params.year}-${mm}`, req);
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
      const entries = monthEntries(accountingModel, params, plan());
      const structured = buildStructuredEntries(entries, plan());
      const mollie = mollieEntries(accountingModel, params, plan());
      const totalDebits = structured.reduce((s, e) => s + e.sumDebits, 0);
      const totalCredits = structured.reduce((s, e) => s + e.sumCredits, 0);
      return res.json({
        entries: structured,
        totals: {
          entriesCount: structured.length,
          totalDebits: Math.round(totalDebits * 100) / 100,
          totalCredits: Math.round(totalCredits * 100) / 100,
          allBalanced: structured.every((e) => e.balanced),
          // specs/reservation-payment-ledger.md rule 43 — a sale whose credits are all on the
          // tourist-tax account carries no revenue and no VAT: shown, never silently exported.
          taxOnlyEntries: taxOnlyEntries(structured),
        },
        // Rules 30-31 — the aid to the accountant: what Mollie still holds, and the credits left unattached.
        mollie: mollie.clearing ? { clearing: mollie.clearing, unattached: mollie.unattached } : null,
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

module.exports = {
  create: createAccountingController,
  monthEntries,
  __test: { parseMonthYear, monthEntries, mollieEntries, taxOnlyEntries },
};
