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
 *   for it; it's collected for the commune). Two routing modes:
 *     • direct + platform-collect: tax (if any) is silently absorbed into the rounding residue of the
 *       deposit + balance entries, as the export engine balances Σ credits to debit.
 *     • owner-collect non-direct (`touristTaxCollectedOnArrival` from the quote): pro-rate against
 *       `finalPrice` (not `totalStayTtc`); the complement entry has its tax portion carved out and
 *       the entry is dropped entirely if it is pure tax (see `buildEntry`).
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
               r.touristTaxInComplement,
               r.accommodationAcompteContribTtc, r.accommodationSoldeContribTtc,
               r.touristTaxAcompteContribTtc, r.touristTaxSoldeContribTtc,
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
        const perLineData = buildPerLineData(database, row, quote);
        const entries = [];
        const inMonth = (paid, date) => paid && date && date >= from && date < nextMonth;
        if (inMonth(row.depositPaid, row.depositPaidDate))     entries.push(buildEntry(row, quote, 'deposit', perLineData));
        if (inMonth(row.balancePaid, row.balancePaidDate))     entries.push(buildEntry(row, quote, 'balance', perLineData));
        if (inMonth(row.complementPaid, row.complementPaidDate)) entries.push(buildEntry(row, quote, 'complement', perLineData));
        // Pure-tax entries are dropped (see `buildEntry`).
        return entries.filter(Boolean);
      });
    },
  };
}

function computeQuoteForReservation(database, row) {
  // Load options + resources from the DB to feed the engine the same shape the controllers do.
  // Per-line `inComplement` + contribs flow through so the engine's quote.optionLines surface
  // them — `buildEntry` then reads them to compute per-bucket attribution per kind.
  const options = database.prepare(`
    SELECT optionId, quantity, billedUnits, unitPrice, priceType, totalPrice, offered,
      COALESCE(inComplement, 0) AS inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_options WHERE reservationId = ?
  `).all(row.id);
  const customOptions = database.prepare(`
    SELECT id AS customOptionId, description, amount, COALESCE(offered, 0) AS offered, sortOrder,
      COALESCE(inComplement, 0) AS inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id
  `).all(row.id);
  const resources = database.prepare(`
    SELECT resourceId, quantity, billedUnits, unitPrice, priceType, totalPrice, offered,
      COALESCE(inComplement, 0) AS inComplement, acompteContribTtc, soldeContribTtc
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
    selectedOptions: options.map((o) => ({ optionId: o.optionId, quantity: o.quantity, inComplement: o.inComplement })),
    customOptions: customOptions.map((c) => ({
      customOptionId: c.customOptionId,
      customKey: String(c.customOptionId),
      description: c.description,
      amount: c.amount,
      offered: Boolean(c.offered),
      inComplement: c.inComplement,
      acompteContribTtc: c.acompteContribTtc,
      soldeContribTtc: c.soldeContribTtc,
    })),
    selectedResources: resources.map((r) => ({ resourceId: r.resourceId, quantity: r.quantity, inComplement: r.inComplement })),
    depositPaid: false,
    balancePaid: false,
    platform: row.platform,
    touristTaxInComplement: row.touristTaxInComplement,
  });
}

// Read the per-line contribs + current totals for one reservation. Used by `buildEntry` to
// drive the contrib-based per-bucket attribution (spec force-item-to-complement.md §5).
function buildPerLineData(database, row, quote) {
  const optionLines = database.prepare(`
    SELECT optionId, totalPrice, COALESCE(offered, 0) AS offered,
      COALESCE(inComplement, 0) AS inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_options WHERE reservationId = ?
  `).all(row.id);
  const customOptionLines = database.prepare(`
    SELECT id AS customOptionId,
      CASE WHEN COALESCE(offered, 0) = 1 THEN 0 ELSE amount END AS totalPrice,
      COALESCE(offered, 0) AS offered,
      COALESCE(inComplement, 0) AS inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_custom_options WHERE reservationId = ?
  `).all(row.id);
  const resourceLines = database.prepare(`
    SELECT resourceId, totalPrice, COALESCE(offered, 0) AS offered,
      COALESCE(inComplement, 0) AS inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_resources WHERE reservationId = ?
  `).all(row.id);

  // Any non-NULL contrib anywhere on the reservation → use the contrib path; else legacy.
  const hasContribs = [
    row.accommodationAcompteContribTtc, row.accommodationSoldeContribTtc,
    row.touristTaxAcompteContribTtc, row.touristTaxSoldeContribTtc,
    ...optionLines.flatMap((l) => [l.acompteContribTtc, l.soldeContribTtc]),
    ...customOptionLines.flatMap((l) => [l.acompteContribTtc, l.soldeContribTtc]),
    ...resourceLines.flatMap((l) => [l.acompteContribTtc, l.soldeContribTtc]),
  ].some((v) => v != null);

  // Current accommodation TTC = finalPrice − options − resources. Same shape as
  // `forceItemContribsCapture.js → computeAccommodationTtc`.
  const optionsCurrentTotal = (optionLines.reduce((s, l) => s + nz(l.totalPrice), 0))
    + (customOptionLines.reduce((s, l) => s + nz(l.totalPrice), 0));
  const resourcesCurrentTotal = resourceLines.reduce((s, l) => s + nz(l.totalPrice), 0);
  const accommodationTtcCurrent = Math.max(0, round2(Number(quote.finalPrice || 0) - optionsCurrentTotal - resourcesCurrentTotal));

  return { optionLines, customOptionLines, resourceLines, hasContribs, accommodationTtcCurrent };
}

// Shape an entry the export engine consumes. Buckets carry HT/VAT for the entry's actual
// contribution per type — and `fraction = 1`, so `accountingExport.js` multiplies by 1 and
// writes the value as-is.
//
// Two paths (spec force-item-to-complement.md §5):
//   1. **Contrib-driven (preferred)**: when ANY per-line `acompteContribTtc` / `soldeContribTtc`
//      is non-NULL on the reservation, we trust those snapshots and the reservation-level
//      `accommodation*ContribTtc` / `touristTax*ContribTtc`. The bucket TTC for `deposit` is
//      `sum(option/resource/custom.acompteContribTtc) + accommodationAcompteContribTtc`. For
//      `balance` we use `soldeContribTtc`. For `complement` we compute `currentTotal − acompte −
//      solde` per line (= the post-payment growth) plus the forced lines at 100 % plus the
//      forced tax portion. This guarantees zero cross-contamination across kinds.
//   2. **Legacy fallback**: when all per-line contribs are NULL (reservation pre-dates this
//      feature), we replay the historic pro-rata behavior: full reservation HT × fraction,
//      where `fraction = encaissementTtc / denominator`. Identical to pre-feature output, so
//      historical exports stay stable.
//
// Tourist tax is excluded from the accountant journal entirely. When the reservation routes
// the tax to complement (`collectedOnArrival` OR `touristTaxInComplement = 1`), we strip the
// tax TTC from the complement entry, and drop the entry if its remainder is 0.
//
// Returns `null` when the entry boils down to pure tourist tax (excluded from the export).
function buildEntry(row, quote, kind, perLineData) {
  const finalPriceTtc = Number(quote.finalPrice || row.finalPrice || 0);
  const touristTaxTotal = Number(row.touristTaxTotal || 0);
  const totalStayTtc = finalPriceTtc + touristTaxTotal;
  const collectedOnArrival = Boolean(quote.touristTaxCollectedOnArrival);
  const taxRoutedToComplement = collectedOnArrival || Number(row.touristTaxInComplement || 0) === 1;

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
  // `perLineData` is optional: when omitted (legacy callers / unit tests that don't model the
  // contrib columns) the fallback path runs unchanged.
  const hasContribs = Boolean(perLineData && perLineData.hasContribs);

  // ── Contrib-driven path ─────────────────────────────────────────────────
  if (hasContribs) {
    const ttcByBucket = computeBucketTtcsFromContribs(row, perLineData, kind, taxRoutedToComplement);
    // Tourist tax for this kind — captured at flip time for deposit/balance; at complement
    // time it's "what's left of the tax after the two prior buckets took their share". The
    // tax is part of the encaissement TTC (the customer paid it) but credited to the
    // pass-through account 46710000 in the export, NOT to a 70xxx revenue line.
    const taxTtc = computeTaxTtcForKind(row, kind);

    const totalTtc = round2(ttcByBucket.accommodation + ttcByBucket.options + ttcByBucket.resources + taxTtc);
    if (totalTtc === 0) return null;

    const buckets = [
      bucketFromTtc('accommodation', ttcByBucket.accommodation, Number(quote.vatPercentageAccommodation || 0)),
      bucketFromTtc('options',       ttcByBucket.options,       Number(quote.vatPercentageOptions       || 0)),
      bucketFromTtc('resources',     ttcByBucket.resources,     Number(quote.vatPercentageResources     || 0)),
    ].filter((b) => b.ht > 0 || b.vat > 0);

    return {
      reservationId: row.id,
      kind,
      paidDate: dateByKind[kind] || null,
      client: { firstName: row.firstName || '', lastName: row.lastName || '' },
      propertyName: row.propertyName || '',
      platform: row.platform || 'direct',
      clientGrossAmount: row.clientGrossAmount == null ? null : Number(row.clientGrossAmount),
      finalPrice: finalPriceTtc,
      // Encaissement TTC = revenue TTC + tax TTC (the customer paid both). The export engine
      // emits a credit on the tax pass-through account so Σ credits == debit holds.
      encaissementTtc: totalTtc,
      taxTtc: round2(taxTtc),
      fraction: 1,
      buckets,
    };
  }

  // ── Legacy fallback (pre-feature reservations, no contribs) ─────────────
  // We keep the historic fraction-based pro-rating BUT we no longer strip the tax: the tax
  // portion of the encaissement now rides on the `46710000` pass-through line so the
  // accountant has a complete picture (post-2026-06-01 policy change, see spec §3.4 rule 14).
  const fraction = totalStayTtc > 0 ? encaissementTtc / totalStayTtc : 0;
  // What portion of the encaissement is tax? In the legacy path we don't have per-bucket
  // contribs — we pro-rate against the total stay TTC. When collectedOnArrival, the deposit
  // and balance carry no tax (their TTC is finalPrice-relative); the tax all lands in
  // complement.
  let legacyTaxTtc;
  if (collectedOnArrival) {
    legacyTaxTtc = kind === 'complement' ? Math.min(touristTaxTotal, encaissementTtc) : 0;
  } else {
    legacyTaxTtc = round2(touristTaxTotal * fraction);
  }

  return {
    reservationId: row.id,
    kind,
    paidDate: dateByKind[kind] || null,
    client: { firstName: row.firstName || '', lastName: row.lastName || '' },
    platform: row.platform || 'direct',
    clientGrossAmount: row.clientGrossAmount == null ? null : Number(row.clientGrossAmount),
    finalPrice: finalPriceTtc,
    encaissementTtc,
    taxTtc: legacyTaxTtc,
    // Legacy path keeps `fraction` so the export engine pro-rates the bucket HT/VAT, and
    // surfaces the tax separately so it can emit a 46710000 credit on top.
    fraction: collectedOnArrival && totalStayTtc > 0
      ? (encaissementTtc - legacyTaxTtc) / finalPriceTtc
      : fraction,
    buckets: [
      bucket('accommodation', quote.accommodationNetPrice, quote.accommodationVatAmount, quote.vatPercentageAccommodation),
      bucket('options', Number(quote.optionsNetPrice || 0), Number(quote.optionsVatAmount || 0), quote.vatPercentageOptions),
      bucket('resources', quote.resourcesNetPrice, quote.resourcesVatAmount, quote.vatPercentageResources),
    ].filter((b) => b.ht > 0 || b.vat > 0),
  };
}

// Tax TTC for a given encaissement kind, read from the per-bucket capture columns. Returns 0
// when the tax was either routed to complement (and this kind isn't 'complement') or
// already-captured-as-zero (e.g. collectedOnArrival path).
function computeTaxTtcForKind(row, kind) {
  if (kind === 'deposit') return round2(nz(row.touristTaxAcompteContribTtc));
  if (kind === 'balance') return round2(nz(row.touristTaxSoldeContribTtc));
  // complement → remainder: full tax minus what's already in deposit + balance.
  const total = nz(row.touristTaxTotal);
  const inDeposit = nz(row.touristTaxAcompteContribTtc);
  const inBalance = nz(row.touristTaxSoldeContribTtc);
  return round2(Math.max(0, total - inDeposit - inBalance));
}

// Aggregate the per-line/per-portion TTCs for a single entry kind. Tax is always excluded.
function computeBucketTtcsFromContribs(row, perLineData, kind, taxRoutedToComplement) {
  const accommodationAcompte = nz(row.accommodationAcompteContribTtc);
  const accommodationSolde   = nz(row.accommodationSoldeContribTtc);
  const accommodationTtcCurrent = perLineData.accommodationTtcCurrent;

  if (kind === 'deposit') {
    return {
      accommodation: round2(accommodationAcompte),
      options:       round2(sumContribField(perLineData.optionLines, 'acompteContribTtc')
                          + sumContribField(perLineData.customOptionLines, 'acompteContribTtc')),
      resources:     round2(sumContribField(perLineData.resourceLines, 'acompteContribTtc')),
    };
  }
  if (kind === 'balance') {
    return {
      accommodation: round2(accommodationSolde),
      options:       round2(sumContribField(perLineData.optionLines, 'soldeContribTtc')
                          + sumContribField(perLineData.customOptionLines, 'soldeContribTtc')),
      resources:     round2(sumContribField(perLineData.resourceLines, 'soldeContribTtc')),
    };
  }
  // kind === 'complement':
  //   - forced lines (`inComplement = 1`): full current `totalPrice`.
  //   - non-forced lines: post-payment delta = `totalPrice - (acompte + solde)`, clamped ≥ 0.
  //   - accommodation: same delta + forced flag has no meaning here (accommodation never forced).
  //   - tax: excluded from the journal regardless of routing.
  const optionsTtc = sumComplementContribution(perLineData.optionLines) + sumComplementContribution(perLineData.customOptionLines);
  const resourcesTtc = sumComplementContribution(perLineData.resourceLines);
  const accommodationDelta = Math.max(0, accommodationTtcCurrent - (accommodationAcompte + accommodationSolde));
  return {
    accommodation: round2(accommodationDelta),
    options:       round2(optionsTtc),
    resources:     round2(resourcesTtc),
  };
}

function sumComplementContribution(lines) {
  return (lines || []).reduce((sum, line) => {
    const total = Number(line.totalPrice || 0);
    if (Number(line.inComplement || 0) === 1) return sum + total;
    if (Number(line.offered || 0) === 1) return sum;
    const acompte = nz(line.acompteContribTtc);
    const solde = nz(line.soldeContribTtc);
    const delta = Math.max(0, total - acompte - solde);
    return sum + delta;
  }, 0);
}

function sumContribField(lines, field) {
  return (lines || []).reduce((sum, line) => sum + nz(line[field]), 0);
}

function nz(value) { return value == null ? 0 : Number(value); }
function round2(value) { return Math.round(Number(value || 0) * 100) / 100; }

// Build a bucket from a TTC contribution: extract HT/VAT using the bucket's rate.
function bucketFromTtc(name, ttc, ratePercent) {
  if (!ttc || ttc <= 0) return { name, ht: 0, vat: 0, ratePercent: Number(ratePercent || 0) };
  const rate = Number(ratePercent || 0);
  const vat = round2(ttc * (rate / (100 + rate)));
  const ht = round2(ttc - vat);
  return { name, ht, vat, ratePercent: rate };
}

function bucket(name, ht, vat, ratePercent) {
  return { name, ht: Number(ht || 0), vat: Number(vat || 0), ratePercent: Number(ratePercent || 0) };
}

const defaultModel = createAccountingModel(db);
defaultModel.create = createAccountingModel;

module.exports = defaultModel;
module.exports.__test = { buildEntry };
