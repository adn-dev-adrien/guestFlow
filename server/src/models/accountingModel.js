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
const platformsModel = require('./platformsModel');
const settingsModel = require('./settingsModel');
const { DEFAULT_COMMISSION_ACCOUNT, VAT_DEDUCTIBLE_COMMISSION_ACCOUNT } = require('../constants/accounting');

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
               COALESCE(r.complementPaidCash, 0) AS complementPaidCash,
               r.endOfStayComplementAmount, r.endOfStayComplementPaid, r.endOfStayComplementPaidDate,
               COALESCE(r.endOfStayComplementPaidCash, 0) AS endOfStayComplementPaidCash,
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
            -- Cash-flagged complements are excluded from accounting (paid « en liquide », off the books).
            (r.complementPaid = 1 AND r.complementPaidDate >= ? AND r.complementPaidDate < ? AND COALESCE(r.complementPaidCash, 0) = 0)
            OR
            (r.endOfStayComplementPaid = 1 AND r.endOfStayComplementPaidDate >= ? AND r.endOfStayComplementPaidDate < ? AND COALESCE(r.endOfStayComplementPaidCash, 0) = 0)
          )
        ORDER BY COALESCE(r.depositPaidDate, r.balancePaidDate, r.complementPaidDate, r.endOfStayComplementPaidDate), r.id
      `).all(from, nextMonth, from, nextMonth, from, nextMonth, from, nextMonth);

      // Read the global commission config once per export run (settings + platforms).
      // accounting-platform-commission-and-no-deposit.md §3.5 rule 11.
      const commissionContext = buildCommissionContext(database);

      // For each reservation, recompute its quote (which loads options/resources/nights from the DB)
      // to get the per-bucket HT + VAT splits. The quote ignores any encaissement-side dates, so this
      // is safe and deterministic.
      return reservations.flatMap((row) => {
        const quote = computeQuoteForReservation(database, row);
        const perLineData = buildPerLineData(database, row, quote);
        const entries = [];
        const inMonth = (paid, date) => paid && date && date >= from && date < nextMonth;
        if (inMonth(row.depositPaid, row.depositPaidDate))     entries.push(buildEntry(row, quote, 'deposit', perLineData, commissionContext));
        if (inMonth(row.balancePaid, row.balancePaidDate))     entries.push(buildEntry(row, quote, 'balance', perLineData, commissionContext));
        // Cash complements are settled off the books → never emitted as an encaissement.
        if (inMonth(row.complementPaid, row.complementPaidDate) && Number(row.complementPaidCash || 0) === 0) {
          entries.push(buildEntry(row, quote, 'complement', perLineData, commissionContext));
        }
        // End-of-stay complement (SAS): a flat TTC amount booked as a « prestation complémentaire »
        // at the app general VAT rate (specs/cash-complement-and-endofstay-finance.md §3.1). Excluded
        // when paid in cash.
        if (inMonth(row.endOfStayComplementPaid, row.endOfStayComplementPaidDate) && Number(row.endOfStayComplementPaidCash || 0) === 0) {
          entries.push(buildEndOfStayEntry(row, commissionContext.vatRate));
        }
        // Pure-tax entries are dropped (see `buildEntry`).
        return entries.filter(Boolean);
      });
    },
  };
}

// One-shot snapshot of the per-platform commission config + the global default account +
// the global VAT rate. Computed once per export-run and threaded into every `buildEntry`
// call so we don't re-query the DB for every line.
function buildCommissionContext(database) {
  const settings = settingsModel.read ? settingsModel.read() : database.prepare('SELECT * FROM app_settings WHERE id = 1').get();
  const defaultAccount = (settings && settings.defaultCommissionAccountNumber) || DEFAULT_COMMISSION_ACCOUNT;
  const vatRateCommission = settings && settings.vatRateCommission != null ? Number(settings.vatRateCommission) : 20;
  // General sales VAT rate (same one the stay/options use) — applied to the end-of-stay complement.
  const vatRate = settings && settings.vatRate != null ? Number(settings.vatRate) : 10;
  // Index platforms by lowercased name for case-insensitive matching (`Airbnb` vs `airbnb`).
  const platforms = (platformsModel.listAll ? platformsModel.listAll() : []) || [];
  const byName = new Map();
  for (const p of platforms) byName.set(String(p.name || '').toLowerCase(), p);
  return { defaultAccount, vatRateCommission, vatRate, platformByName: byName };
}

// Resolve the commission config for one reservation. Returns null for direct bookings (no
// platform → no commission line). Returns `{ account, hasVat }` otherwise.
function resolveCommissionConfig(row, commissionContext) {
  if (!commissionContext) return null;
  const platform = String(row.platform || 'direct').toLowerCase();
  if (platform === 'direct') return null;
  const platformRow = commissionContext.platformByName.get(platform);
  const account = (platformRow && platformRow.commissionAccountNumber) || commissionContext.defaultAccount;
  const hasVat = platformRow ? Boolean(Number(platformRow.hasVatOnCommission)) : false;
  return { account, hasVat };
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
  // 2026-06-05 — the legacy path of `buildEntry` (taken when ALL contribs are NULL on a
  // reservation, e.g. a Solde flipped before the force-item-to-complement feature shipped)
  // reads buckets straight off this recomputed `quote`. To keep the buckets aligned with the
  // money actually persisted on the row, the engine MUST see the same routing+overrides the
  // controller fed it on save. Specifically:
  //
  //   - `offeredOptionIds` / `offered`: without them the engine rebuilds option lines at their
  //     catalog price (offered options resurface — e.g. an 80 € ménage that the operator
  //     offered to 0 €), `quote.optionsTotal` grows, and the legacy bucket emits a phantom
  //     70600010 (`Prestation complémentaire`) credit. The residue absorption on the last
  //     credit (`accountingExport.js → entryToRows`) then drives the VAT line NEGATIVE to
  //     keep Σ credits == grossDebit. Symptom: a `Frais Gîtes de France` export with
  //     `44571100 VAT 10% = -17,36 €` reported on Chloé Le Lann's reservation
  //     (resa #5 on prod, balancePaidDate 2026-05-07).
  //   - `customPrice`: without it the engine recomputes accommodation from the pricing rules
  //     and ignores the operator's manual override stored on `reservations.customPrice`. Same
  //     residue-absorption side-effect, just on the accommodation bucket.
  //
  // Passing both fields makes the legacy path's buckets match `row.finalPrice` exactly →
  // residue collapses to ≤ 1 cent of pure rounding noise → no negative VAT.
  const offeredOptionIds = options.filter((o) => Number(o.offered) === 1).map((o) => Number(o.optionId));
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
    selectedOptions: options.map((o) => ({
      optionId: o.optionId,
      quantity: o.quantity,
      inComplement: o.inComplement,
      offered: Boolean(o.offered),
    })),
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
    selectedResources: resources.map((r) => ({
      resourceId: r.resourceId,
      quantity: r.quantity,
      inComplement: r.inComplement,
      offered: Boolean(r.offered),
    })),
    offeredOptionIds,
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
//
// accounting-platform-commission-and-no-deposit.md §3.5 rules 11–13:
//   - CA HT is recognised on the GROSS (`clientGrossAmount`), so revenue buckets are scaled
//     by `effectiveGross / finalPrice` before being returned.
//   - Commission TTC = effectiveGross − finalPrice for the balance entry of a non-direct
//     reservation; 0 elsewhere (deposit on platforms is always 0 post-migration; complement
//     is host-billed extras with no commission).
//   - The CCLIENT debit drops to the **net** (= bank movement). The commission HT debit +
//     optional VAT debit absorb the gap so Σ debits = Σ credits = gross TTC.
function buildEntry(row, quote, kind, perLineData, commissionContext) {
  // Use the STORED `row.finalPrice` (= the price the user actually committed to and what every
  // other GuestFlow surface displays — fiche réservation, projections, finance summary) and
  // fall back to the engine's recompute only when the stored value is missing (iCal imports
  // with blank prices). Regression 2026-06-02: Adrien spotted a transaction in the platforms
  // table whose commission was 0 € while the fiche showed it correctly. Cause: the engine
  // recomputed `quote.finalPrice` from the current pricing rules + options, which had drifted
  // upwards from the stored `row.finalPrice` since the booking was paid. The commission
  // (`gross − finalPrice`) collapsed to 0 because `quote.finalPrice ≥ gross`. Preferring the
  // stored value makes both surfaces show the same number for the same money flow.
  const finalPriceTtc = Number(row.finalPrice || quote.finalPrice || 0);
  const touristTaxTotal = Number(row.touristTaxTotal || 0);
  const totalStayTtc = finalPriceTtc + touristTaxTotal;
  const collectedOnArrival = Boolean(quote.touristTaxCollectedOnArrival);
  const taxRoutedToComplement = collectedOnArrival || Number(row.touristTaxInComplement || 0) === 1;

  // specs/per-platform-tourist-tax-three-way.md §3 rule 5 — case 1 "platform reverses the tax to us".
  // The tax is OFFERED on our quote (so `row.touristTaxTotal` is 0 and it's NOT in the deposit/balance
  // schedule), yet WE remit it to the commune. The platform settles in a single payout that INCLUDES
  // the tax → it rides the `balance` entry as a 46710000 pass-through (added to the encaissement, not
  // to revenue; the commission is computed on the stay only, so it's untouched). Cases 2/3/direct are
  // unchanged: case 2 has no tax in the books, case 3 + direct already carry it via `touristTaxTotal`.
  const isPlatformReversedTax = Boolean(quote.touristTaxOfferedByPlatform) && Boolean(quote.touristTaxRemittedByOwner);
  const reversedPlatformTaxTtc = (isPlatformReversedTax && kind === 'balance')
    ? round2(Number(quote.touristTaxOriginalTotal || 0))
    : 0;

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

  // Defensive null-return for the (rare) case of a `*Paid = 1 + *PaidDate in month` but
  // `*Amount = 0`. Real-world cause: a reservation toggled `depositDisabled = ON` after the
  // user had already clicked "Marquer acompte payé" — depositPaid stays 1 but depositAmount
  // collapses to 0. Same idea for an accidentally-flipped complementPaid on a reservation
  // with no actual complement to perceive. Without this guard the entry was still emitted
  // (the legacy fallback path had no `null`-return for zero-revenue entries — only the
  // contrib-driven path did), producing a phantom "tout à zéro" row in the platforms table
  // + a balanced-but-empty card in the journal preview. See spec accountant-accounting-
  // export.md §3.4 rule 12bis.
  if (encaissementTtc === 0) return null;

  // Gross/net resolution + commission for this entry (§3.5).
  // - Direct: gross === net (= finalPrice). The backfill at boot ensures `row.clientGrossAmount`
  //   is populated for directs; we still defensively fall back to finalPrice on legacy NULL.
  // - Platform: gross > net by the commission amount. The full commission rides on the
  //   `balance` entry (deposit is 0 post-migration; complement is on-site extras).
  const platformIsNonDirect = String(row.platform || 'direct').toLowerCase() !== 'direct';
  const effectiveGross = Math.max(
    finalPriceTtc,
    Number(row.clientGrossAmount != null ? row.clientGrossAmount : finalPriceTtc) || 0,
  );
  const commissionTtcTotal = round2(Math.max(0, effectiveGross - finalPriceTtc));
  const grossRatio = finalPriceTtc > 0 ? effectiveGross / finalPriceTtc : 1;
  // Per-entry commission share — full on balance for non-direct platforms; 0 otherwise.
  const commissionTtcEntry = (platformIsNonDirect && kind === 'balance')
    ? commissionTtcTotal
    : 0;
  // Resolve compte commission + hasVat from the global config snapshot.
  const commissionResolved = commissionTtcEntry > 0
    ? resolveCommissionConfig(row, commissionContext)
    : null;
  const vatRateCommission = commissionContext && Number.isFinite(Number(commissionContext.vatRateCommission))
    ? Number(commissionContext.vatRateCommission)
    : 20;
  let commissionLine = null;
  if (commissionResolved && commissionTtcEntry > 0) {
    const hasVat = commissionResolved.hasVat;
    const ht = hasVat
      ? round2(commissionTtcEntry / (1 + vatRateCommission / 100))
      : round2(commissionTtcEntry);
    const vat = hasVat ? round2(commissionTtcEntry - ht) : 0;
    commissionLine = {
      account: commissionResolved.account,
      hasVat,
      ttc: round2(commissionTtcEntry),
      ht,
      vat,
      vatAccount: VAT_DEDUCTIBLE_COMMISSION_ACCOUNT,
      vatRate: vatRateCommission,
    };
  }

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
    // `reversedPlatformTaxTtc` adds the case-1 "platform reverses it to us" tax onto the balance
    // payout (it's 0 for every other case/kind). `totalGrossTtc` + the encaissement below pick it
    // up automatically since they sum `taxTtc`.
    const taxTtc = computeTaxTtcForKind(row, kind) + reversedPlatformTaxTtc;

    // Scale per-bucket TTCs by the gross ratio so the credited HT + VAT reflect the BRUT
    // the customer paid the platform (§3.5). For directs grossRatio === 1, so this is a
    // no-op and the entry shape stays identical to the pre-spec output.
    const grossByBucket = {
      accommodation: round2(ttcByBucket.accommodation * grossRatio),
      options:       round2(ttcByBucket.options       * grossRatio),
      resources:     round2(ttcByBucket.resources     * grossRatio),
    };
    const totalGrossTtc = round2(grossByBucket.accommodation + grossByBucket.options + grossByBucket.resources + taxTtc);
    if (totalGrossTtc === 0) return null;
    // Net = what the owner banks; commission absorbs the difference on the debit side.
    const encaissementNetTtc = round2(totalGrossTtc - (commissionLine ? commissionLine.ttc : 0));

    const buckets = [
      bucketFromTtc('accommodation', grossByBucket.accommodation, Number(quote.vatPercentageAccommodation || 0)),
      bucketFromTtc('options',       grossByBucket.options,       Number(quote.vatPercentageOptions       || 0)),
      bucketFromTtc('resources',     grossByBucket.resources,     Number(quote.vatPercentageResources     || 0)),
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
      // Encaissement TTC = revenue-on-gross TTC + tax TTC. The export engine credits revenue
      // 70xxx + VAT 44571xxx on this gross figure, and the CCLIENT debit + commission debits
      // sum to the same value (§3.5).
      encaissementTtc: totalGrossTtc,
      encaissementNetTtc,
      commission: commissionLine,
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
  // Case 1 (platform reverses it to us): the offered tax (touristTaxTotal = 0 here) rides the
  // balance payout as a 46710000 pass-through. Added on top — it's not scaled by the stay fraction
  // and carries no commission.
  legacyTaxTtc = round2(legacyTaxTtc + reversedPlatformTaxTtc);

  // §3.5 — legacy path: same gross-ratio scaling, applied through `fraction`. We scale the
  // computed `fraction` by `grossRatio` so the buckets (still computed on NET in the engine
  // quote) end up at the right gross HT/VAT when the CSV does `bucket.ht × fraction`.
  // The encaissement reported to the export = encaissement × grossRatio so the credits sum
  // to the gross. Commission gets booked separately on the debit side.
  const legacyEncaissementGross = round2(encaissementTtc * grossRatio + reversedPlatformTaxTtc);
  const legacyFraction = collectedOnArrival && totalStayTtc > 0
    ? ((encaissementTtc - legacyTaxTtc) / finalPriceTtc) * grossRatio
    : fraction * grossRatio;
  const legacyEncaissementNet = round2(legacyEncaissementGross - (commissionLine ? commissionLine.ttc : 0));

  return {
    reservationId: row.id,
    kind,
    paidDate: dateByKind[kind] || null,
    client: { firstName: row.firstName || '', lastName: row.lastName || '' },
    propertyName: row.propertyName || '',
    platform: row.platform || 'direct',
    clientGrossAmount: row.clientGrossAmount == null ? null : Number(row.clientGrossAmount),
    finalPrice: finalPriceTtc,
    encaissementTtc: legacyEncaissementGross,
    encaissementNetTtc: legacyEncaissementNet,
    commission: commissionLine,
    taxTtc: legacyTaxTtc,
    fraction: legacyFraction,
    buckets: [
      bucket('accommodation', quote.accommodationNetPrice, quote.accommodationVatAmount, quote.vatPercentageAccommodation),
      bucket('options', Number(quote.optionsNetPrice || 0), Number(quote.optionsVatAmount || 0), quote.vatPercentageOptions),
      bucket('resources', quote.resourcesNetPrice, quote.resourcesVatAmount, quote.vatPercentageResources),
    ].filter((b) => b.ht > 0 || b.vat > 0),
  };
}

// End-of-stay complement (departure SAS): a flat TTC amount (ménage + linge manquant) outside the
// pricing engine. Booked as a single « prestation complémentaire » revenue line (account 70600010)
// at the app general VAT rate — parity with how the arrival complement's cleaning/linen is booked
// (specs/cash-complement-and-endofstay-finance.md §3.1 + Q1). Collected on-site by the owner: no
// platform commission, no tourist tax. Returns null when there's nothing to book.
function buildEndOfStayEntry(row, vatRate) {
  const ttc = round2(Number(row.endOfStayComplementAmount || 0));
  if (ttc <= 0) return null;
  const b = bucketFromTtc('options', ttc, Number(vatRate || 0));
  return {
    reservationId: row.id,
    kind: 'endOfStayComplement',
    paidDate: row.endOfStayComplementPaidDate || null,
    client: { firstName: row.firstName || '', lastName: row.lastName || '' },
    propertyName: row.propertyName || '',
    platform: row.platform || 'direct',
    clientGrossAmount: null,
    finalPrice: ttc,
    encaissementTtc: ttc,
    encaissementNetTtc: ttc,
    commission: null,
    taxTtc: 0,
    fraction: 1,
    buckets: [b].filter((x) => x.ht > 0 || x.vat > 0),
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
