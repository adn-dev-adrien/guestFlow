/**
 * Accounting synthesis model (specs/accounting-synthesis.md §4.1) — the reads the synthesis is built from.
 * It writes nothing. The journal's entries come from the export's own month stream (`monthEntries`, the
 * CSV's), the stays' figures and the tourist tax from the core's finance model, the comparison with last
 * year from the Suivi financier's one reading. Nothing here re-derives a figure another screen shows.
 */

const sdk = require('../sdk');
const { create: createAccountingModel } = require('./accountingModel');
const { monthEntries } = require('./controller');
const { readLastCsvExport } = require('./settings');
const { monthsOf } = require('./synthesisPeriod');

const vatRegimeModel = sdk.coreModule('vatRegimeModel');
const { isDirectChannel } = sdk.coreModule('platformNameFormat');

const hasTable = (database, name) => {
  try { return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)); }
  catch { return false; }
};

// Rule 13 — which link types settle which entry of the journal.
const LINK_TYPES_OF = {
  deposit: ['deposit', 'full'],
  balance: ['balance', 'full'],
  complement: ['complement'],
};

function createSynthesisModel(database, deps = {}) {
  const accounting = deps.accountingModel || createAccountingModel(database);
  const finance = deps.finance || sdk.coreModule('financeModel').buildModel(database);
  const dashboard = deps.dashboard || sdk.coreModule('financeDashboardModel').buildModel(database);
  const links = deps.paymentLinks || sdk.coreModule('paymentLinksModel').buildModel(database);
  const H = sdk.coreModule('financeModel').helpers;

  return {
    today: () => H.todayIso(),
    fiscalEndMonth: () => H.getFiscalYearEndMonth(database),

    /** Rule 4 — every journal entry dated in [from, to]: the months' streams of the CSV, cut to the days. */
    entriesBetween(from, to) {
      return monthsOf(from, to).flatMap((ym) => monthEntries(accounting, { year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)) }))
        .filter((entry) => entry.paidDate && entry.paidDate >= from && entry.paidDate <= to);
    },

    /**
     * Rule 13 — how the money of an entry came, as the data records it: a platform paid it (an OTA sale's
     * acompte or solde, a platform penalty, an indemnity a platform wired), a paid payment link settled
     * it, or it was marked perçu on the fiche. Built per request: the links of a stay are read once.
     */
    meansResolver() {
      const byStay = new Map();
      const installmentNumbers = new Map();
      const hasLinks = hasTable(database, 'payment_links');
      const hasInstallments = hasTable(database, 'reservation_installments');
      const paidLinksOf = (id) => {
        if (!byStay.has(id)) byStay.set(id, hasLinks ? links.listForStay(id).filter((l) => l.status === 'paid') : []);
        return byStay.get(id);
      };
      const installmentIdOf = (reservationId, number) => {
        if (!hasInstallments) return null;
        if (!installmentNumbers.has(reservationId)) {
          installmentNumbers.set(reservationId, new Map(database.prepare('SELECT id, number FROM reservation_installments WHERE reservationId = ?')
            .all(reservationId).map((r) => [Number(r.number), Number(r.id)])));
        }
        return installmentNumbers.get(reservationId).get(Number(number)) ?? null;
      };
      const platformSale = (platform) => Boolean(platform) && !isDirectChannel(platform);
      return (entry) => {
        if (entry.direction === 'penalty') return 'platform';
        if (entry.direction === 'compensation') return platformSale(entry.platform) ? 'platform' : 'recorded';
        if ((entry.kind === 'deposit' || entry.kind === 'balance') && platformSale(entry.platform)) return 'platform';
        if (entry.reservationId == null) return 'recorded';
        const paid = paidLinksOf(Number(entry.reservationId));
        if (entry.kind === 'installment' && entry.installment) {
          const id = installmentIdOf(Number(entry.reservationId), entry.installment.number);
          return paid.some((l) => l.type === 'installment' && Number(l.installmentId) === id) ? 'paymentLink' : 'recorded';
        }
        const types = LINK_TYPES_OF[entry.kind];
        return types && paid.some((l) => types.includes(l.type)) ? 'paymentLink' : 'recorded';
      };
    },

    /** Rule 7 — the stays of the window as the Suivi financier attributes them (getSummary). */
    summary({ from, to, fiscalYear, knownAt = null }) {
      return finance.getSummary({ from, to, fiscalYear, knownAt });
    },

    /**
     * Rule 8 — the tourist tax WE remit, month by month as the « Taxe de séjour » page extracts it, summed.
     * A month after the server's one has nothing to declare yet: the page refuses it, so does this sum.
     */
    touristTax(months, today) {
      let amountCents = 0;
      let stays = 0;
      for (const ym of months) {
        if (ym > today.slice(0, 7)) continue;
        const result = finance.getTouristTaxExtraction({ month: ym });
        if (!result.ok) continue;
        amountCents += Math.round(Number(result.data.totals.taxAmount || 0) * 100);
        stays += Number(result.data.totals.reservationsCount || 0);
      }
      return { amount: amountCents / 100, stays };
    },

    /** Rule 9 — the comparable part of the window and its twin a year earlier (D-HC7). */
    lastYearRange(window, today) {
      return dashboard.lastYearRange({ window, today, propertyId: null });
    },

    lastCsvExport: () => readLastCsvExport(database),

    /** Rule 5 — the VAT regime in force (vat-optional-mode), or null on a database without periods. */
    regimeInForce: () => vatRegimeModel.inForceBlock(database),
  };
}

module.exports = { create: createSynthesisModel };
