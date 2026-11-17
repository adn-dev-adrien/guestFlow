/**
 * Accounting controller — orchestrates the monthly sales CSV export and the platform-commission
 * preview. Thin: delegates to accountingModel (data), accountingExport (engine) and the core CSV
 * serializer. Accessible to both admins and the read-only accountant role.
 */

const sdk = require('../sdk');
const { csvJournal, salesJson } = require('./accountingExport');
const { drinksAccountRefusal } = require('./drinksGuard');
const { roundMoneyStrict, fromCentsStrict } = sdk.coreModule('money');
const { MOLLIE_DEFAULTS } = require('./settings');

const { journalEntries } = sdk.coreModule('accountingOutput');

function parseMonthYear(query) {
  const month = Number(query.month);
  const year = Number(query.year);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(year) || year < 2000 || year > 9999) return null;
  return { month, year };
}

// Sales + refunds + cancellation compensations of the month (the core's `journalEntries`), and the entries a live plugin books
// in its own journal (the Mollie journal, specs/mollie-rolling-reserve-and-incoming-payments.md rules 28-31), in one
// chronological stream: the CSV, the JSON preview and the synthesis can never drift apart.
function monthEntries(accountingModel, params, plan = {}, mollie = null) {
  return [...journalEntries(params, accountingModel), ...(mollie || mollieEntries(accountingModel, params, plan)).entries]
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
  // The journal code and the three accounts ride on the entry: the core's journal lines book a Mollie entry on them, outside the
  // sales journal's plan.
  const mollieAccounts = {
    journal: String(accounts.mollieJournalCode), clearing: String(accounts.mollieClearingAccount),
    bank: String(accounts.mollieBankAccount), fee: String(accounts.mollieFeeAccount),
  };
  const entries = found.entries.filter((e) => MOLLIE_KINDS.has(e.kind) && (withBank || e.kind !== 'credit')).map((e) => ({
    reservationId: e.reservationId == null ? null : e.reservationId, kind: 'mollie', direction: 'mollie', mollieKind: e.kind, paidDate: e.date,
    client: e.client || { firstName: '', lastName: '' }, amount: fromCentsStrict(e.amountCents), encaissementTtc: fromCentsStrict(e.amountCents),
    libelle: e.libelle || '', settlementReference: e.settlementReference || '', qontoReference: e.qontoReference || '', accountLabels: labels,
    mollieAccounts,
  }));
  return {
    entries,
    unattached: found.unattached.map((u) => ({ ...u, amount: fromCentsStrict(u.amountCents) })),
    clearing: found.clearing ? {
      account: String(accounts.mollieClearingAccount), asOf: found.clearing.asOf, balance: fromCentsStrict(found.clearing.balanceCents),
      clients: found.clearing.clients.map((c) => ({ ...c, balance: fromCentsStrict(c.balanceCents) })),
    } : null,
  };
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
      const refusal = drinksAccountRefusal(entries, plan());
      if (refusal) return res.status(refusal.status).json(refusal.body);
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
      // The Mollie facts are read once for the response: the stream and the clearing aid come from the same read.
      const mollie = mollieEntries(accountingModel, params, plan());
      const entries = monthEntries(accountingModel, params, plan(), mollie);
      const refusal = drinksAccountRefusal(entries, plan());
      if (refusal) return res.status(refusal.status).json(refusal.body);
      // Rules 30-31 — the aid to the accountant: what Mollie still holds, and the credits left unattached.
      return res.json({
        ...salesJson.export(entries, { plan: plan() }).body,
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
          commission: e.commission ? roundMoneyStrict(e.commission.ttc) : null,
          // specs/single-payment-at-check-in.md §3.3 rule 13 — la collecte à laquelle cette écriture
          // appartient. Le tableau replie les écritures d'un même paiement en UNE ligne : sans ça il
          // affichait deux encaissements pour un seul mouvement bancaire, à rebours de la carte de
          // journal juste au-dessus qui, elle, les regroupe déjà (constaté en production 2026-09-01).
          paymentGroup: e.paymentGroup || null,
        }));
      const totalCommission = platformRows.reduce((s, r) => s + (r.commission || 0), 0);
      return res.json({ rows: platformRows, totalCommission: roundMoneyStrict(totalCommission) });
    },
  };
}

module.exports = {
  create: createAccountingController,
  monthEntries,
  __test: { parseMonthYear, monthEntries, mollieEntries, taxOnlyEntries: salesJson.__test.taxOnlyEntries },
};
