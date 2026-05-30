/**
 * Accounting model — DB access layer for the monthly accounting export.
 *
 * One "encaissement" = one deposit or one balance whose **paid date** falls in the selected month.
 * For each, we fetch the underlying reservation + client + property + per-bucket HT/VAT from the
 * pricing engine quote. The pure `accountingExport` util takes this shape and produces the balanced
 * journal lines (see utils/accountingExport.js).
 *
 * Scope (spec §3.4):
 * - Only `kind='reservation'` rows (devis never exported).
 * - Caution is excluded entirely (handled by ignoring `caution*` fields).
 * - Tourist tax is excluded from the revenue accounts (kept out of the export — accountant doesn't ask
 *   for it; it's collected for the commune).
 *
 * Factory `create(db)` (+ a default bound to the production DB), mirroring the other models.
 */

const db = require('../database');
const { calculateReservationQuote } = require('../utils/pricing');

function createAccountingModel(database) {
  return {
    // List every encaissement (deposit + balance) whose paid date falls in [`YYYY-MM-01`, end of month].
    // Returns enriched entries already carrying the per-bucket HT/VAT and the platform info.
    encaissementsByMonth({ month, year }) {
      const mm = String(month).padStart(2, '0');
      const yyyy = String(year);
      const from = `${yyyy}-${mm}-01`;
      // SQLite quirk: 'YYYY-MM-DD' compares lexicographically; build an exclusive upper bound.
      const nextMonth = Number(mm) === 12 ? `${Number(yyyy) + 1}-01-01` : `${yyyy}-${String(Number(mm) + 1).padStart(2, '0')}-01`;

      const reservations = database.prepare(`
        SELECT r.id, r.propertyId, r.clientId, r.startDate, r.endDate,
               r.checkInTime, r.checkOutTime,
               r.adults, r.children, r.teens, r.babies,
               r.platform, r.discountPercent, r.customPrice,
               r.depositAmount, r.depositPaid, r.depositPaidDate,
               r.balanceAmount, r.balancePaid, r.balancePaidDate,
               r.complementAmount, r.complementPaid, r.complementPaidDate,
               r.finalPrice, r.clientGrossAmount,
               r.totalPrice, r.touristTaxTotal,
               c.firstName, c.lastName,
               p.name AS propertyName
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation'
          AND (
            (r.depositPaid = 1 AND r.depositPaidDate >= ? AND r.depositPaidDate < ?)
            OR
            (r.balancePaid = 1 AND r.balancePaidDate >= ? AND r.balancePaidDate < ?)
            OR
            (r.complementPaid = 1 AND r.complementPaidDate >= ? AND r.complementPaidDate < ?)
          )
        ORDER BY COALESCE(r.depositPaidDate, r.balancePaidDate, r.complementPaidDate), r.id
      `).all(from, nextMonth, from, nextMonth, from, nextMonth);

      // For each reservation, recompute its quote (which loads options/resources/nights from the DB)
      // to get the per-bucket HT + VAT splits. The quote ignores any encaissement-side dates, so this
      // is safe and deterministic.
      return reservations.flatMap((row) => {
        const quote = computeQuoteForReservation(database, row);
        const entries = [];
        const inMonth = (paid, date) => paid && date && date >= from && date < nextMonth;
        if (inMonth(row.depositPaid, row.depositPaidDate))     entries.push(buildEntry(row, quote, 'deposit'));
        if (inMonth(row.balancePaid, row.balancePaidDate))     entries.push(buildEntry(row, quote, 'balance'));
        if (inMonth(row.complementPaid, row.complementPaidDate)) entries.push(buildEntry(row, quote, 'complement'));
        return entries;
      });
    },
  };
}

function computeQuoteForReservation(database, row) {
  // Load options + resources from the DB to feed the engine the same shape the controllers do.
  const options = database.prepare(`
    SELECT optionId, quantity, billedUnits, unitPrice, priceType, totalPrice, offered
    FROM reservation_options WHERE reservationId = ?
  `).all(row.id);
  const customOptions = database.prepare(`
    SELECT id AS customKey, description, amount, COALESCE(offered, 0) AS offered, sortOrder
    FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id
  `).all(row.id);
  const resources = database.prepare(`
    SELECT resourceId, quantity, billedUnits, unitPrice, priceType, totalPrice, offered
    FROM reservation_resources WHERE reservationId = ?
  `).all(row.id);
  return calculateReservationQuote({
    db: database,
    propertyId: row.propertyId,
    startDate: row.startDate,
    endDate: row.endDate,
    checkInTime: row.checkInTime,
    checkOutTime: row.checkOutTime,
    adults: row.adults,
    children: row.children,
    teens: row.teens,
    babies: row.babies,
    discountPercent: row.discountPercent,
    customPrice: row.customPrice,
    selectedOptions: options.map((o) => ({ optionId: o.optionId, quantity: o.quantity })),
    customOptions: customOptions.map((c) => ({ customKey: String(c.customKey), description: c.description, amount: c.amount, offered: Boolean(c.offered) })),
    selectedResources: resources.map((r) => ({ resourceId: r.resourceId, quantity: r.quantity })),
    depositPaid: false,
    balancePaid: false,
    platform: row.platform,
  });
}

// Shape an entry the export engine consumes. Buckets carry the HT, VAT amount and VAT rate
// (the engine has already extracted them from TTC).
function buildEntry(row, quote, kind) {
  // Pro-rata is computed against the *total stay TTC* (finalPrice + tourist tax) so the 3 encaissement
  // kinds sum back to 100 % of the stay: deposit + balance + complement = totalStayPrice.
  const finalPriceTtc = Number(quote.finalPrice || row.finalPrice || 0);
  const totalStayTtc = finalPriceTtc + Number(row.touristTaxTotal || 0);
  const amountByKind = {
    deposit:    Number(row.depositAmount)    || 0,
    balance:    Number(row.balanceAmount)    || 0,
    complement: Number(row.complementAmount) || 0,
  };
  const dateByKind = {
    deposit:    row.depositPaidDate,
    balance:    row.balancePaidDate,
    complement: row.complementPaidDate,
  };
  const encaissementTtc = amountByKind[kind] || 0;
  const fraction = totalStayTtc > 0 ? encaissementTtc / totalStayTtc : 0;
  return {
    reservationId: row.id,
    kind,
    paidDate: dateByKind[kind] || null,
    client: { firstName: row.firstName || '', lastName: row.lastName || '' },
    platform: row.platform || 'direct',
    clientGrossAmount: row.clientGrossAmount == null ? null : Number(row.clientGrossAmount),
    finalPrice: finalPriceTtc,
    encaissementTtc,
    fraction,
    buckets: [
      bucket('accommodation', quote.accommodationNetPrice, quote.accommodationVatAmount, quote.vatPercentageAccommodation),
      bucket('options', sum(Number(quote.optionsNetPrice || 0), customNet(quote)),
                       sum(Number(quote.optionsVatAmount || 0), customVat(quote)),
                       quote.vatPercentageOptions),
      bucket('resources', quote.resourcesNetPrice, quote.resourcesVatAmount, quote.vatPercentageResources),
    ].filter((b) => b.ht > 0 || b.vat > 0),
  };
}

function bucket(name, ht, vat, ratePercent) {
  return { name, ht: Number(ht || 0), vat: Number(vat || 0), ratePercent: Number(ratePercent || 0) };
}

// Custom options ride on the standard "options" bucket; the engine already includes them in
// optionsTotal/optionsNetPrice/optionsVatAmount, so these helpers return 0 (kept so the calling
// site is clear about intent and future-proof if the engine ever separates them).
function customNet() { return 0; }
function customVat() { return 0; }
function sum(a, b) { return Number(a || 0) + Number(b || 0); }

const defaultModel = createAccountingModel(db);
defaultModel.create = createAccountingModel;

module.exports = defaultModel;
module.exports.__test = { buildEntry };
