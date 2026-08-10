/**
 * Accounting model — DB access layer for the monthly accounting export.
 *
 * One "encaissement" = one deposit or one balance whose **paid date** falls in the selected month.
 * For each, we fetch the underlying reservation + client + property and derive the per-bucket
 * HT/VAT from the STORED row money (finalPrice + persisted line totals) — never from a recomputed
 * pricing-engine quote, whose rules may have drifted since the booking was paid
 * (specs/accounting-encaissement-effective-percent.md). The pure `accountingExport` util takes
 * this shape and produces the balanced journal lines (see utils/accountingExport.js).
 *
 * Scope (spec §3.4):
 * - Only `kind='reservation'` rows (devis never exported).
 * - Caution is excluded entirely (handled by ignoring `caution*` fields).
 * - Tourist tax never hits a revenue account: it rides the 46710000 pass-through line, entirely
 *   on the solde entry (specs/tourist-tax-on-solde.md) — or on the complement when the routing
 *   sends it there (owner-collect platforms / `touristTaxInComplement`).
 *
 * Factory `create(db)` (+ a default bound to the production DB), mirroring the other models.
 */

const db = require('../database');
const { isPlatformCollectingTouristTax } = require('../utils/pricing');
const platformsModel = require('./platformsModel');
const settingsModel = require('./settingsModel');
const { DEFAULT_COMMISSION_ACCOUNT, VAT_DEDUCTIBLE_COMMISSION_ACCOUNT } = require('../constants/accounting');
const { resolveMidStaySplit, storedMidStayLines, extraLineKey, parseNotes } = require('../utils/midStayExtras');
const { createModel: createRefundsModel } = require('./refundsModel');

function createAccountingModel(database) {
  // Mid-stay columns (specs/mid-stay-extras-to-end-of-stay-complement.md). Guarded like the
  // reservationsModel ones so a minimal test schema without them degrades to the legacy attribution
  // (nothing sold mid-stay) instead of failing the query.
  const hasReservationColumn = (name) => {
    try { return database.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === name); }
    catch { return false; }
  };
  const midStayCols = [
    hasReservationColumn('endOfStayComplementDetail') ? 'r.endOfStayComplementDetail' : "NULL AS endOfStayComplementDetail",
    hasReservationColumn('arrivalExtrasBaseline') ? 'r.arrivalExtrasBaseline' : 'NULL AS arrivalExtrasBaseline',
    hasReservationColumn('midStaySettledNotes') ? 'r.midStaySettledNotes' : 'NULL AS midStaySettledNotes',
  ].join(', ');
  // A stay whose ONLY collection of the month is a « note en séjour » must still be selected — its
  // buckets may all be paid in another month, or not at all yet (specs/mid-stay-notes.md §3.4).
  // Month prefix match on the serialised `paidDate`; `inMonth` below stays the authoritative filter.
  const hasNotesColumn = hasReservationColumn('midStaySettledNotes');
  const midStayNotesClause = hasNotesColumn ? 'OR (r.midStaySettledNotes LIKE ?)' : '';
  const midStayNotesParams = (from) => (hasNotesColumn ? [`%"paidDate":"${String(from).slice(0, 8)}%`] : []);
  // Refunds live in their own tables, so the month filter is a plain range predicate (no LIKE scan
  // like the notes register needs). Bound to the same database so the test factory covers both.
  const refunds = createRefundsModel(database);
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
               ${midStayCols},
               r.finalPrice, r.clientGrossAmount, r.platformCommissionAmount, r.acompteCommissionAmount,
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
            ${midStayNotesClause}
          )
        ORDER BY COALESCE(r.depositPaidDate, r.balancePaidDate, r.complementPaidDate, r.endOfStayComplementPaidDate), r.id
      `).all(from, nextMonth, from, nextMonth, from, nextMonth, from, nextMonth, ...midStayNotesParams(from));

      // Read the global commission config once per export run (settings + platforms).
      // accounting-platform-commission-and-no-deposit.md §3.5 rule 11.
      const commissionContext = buildCommissionContext(database);

      return reservations.flatMap((row) => {
        const perLineData = buildPerLineData(database, row);
        // Tax collected at check-in (→ complement) only when WE charge the guest directly, i.e. a
        // non-direct platform that does NOT collect the tax from the guest (case 3 « owner » of
        // specs/per-platform-tourist-tax-three-way.md). Mirrors the pricing engine's
        // `isTouristTaxCollectedOnArrival` without recomputing a full quote.
        const collectedOnArrival = String(row.platform || 'direct').toLowerCase() !== 'direct'
          && Number(row.touristTaxTotal || 0) > 0
          && !isPlatformCollectingTouristTax(database, row.propertyId, row.platform);
        const taxContext = { collectedOnArrival };
        const entries = [];
        const inMonth = (paid, date) => paid && date && date >= from && date < nextMonth;
        if (inMonth(row.depositPaid, row.depositPaidDate))     entries.push(buildEntry(row, 'deposit', perLineData, commissionContext, taxContext));
        if (inMonth(row.balancePaid, row.balancePaidDate))     entries.push(buildEntry(row, 'balance', perLineData, commissionContext, taxContext));
        // Cash complements are settled off the books → never emitted as an encaissement.
        if (inMonth(row.complementPaid, row.complementPaidDate) && Number(row.complementPaidCash || 0) === 0) {
          entries.push(buildEntry(row, 'complement', perLineData, commissionContext, taxContext));
        }
        // End-of-stay complement (SAS): a flat TTC amount booked as a « prestation complémentaire »
        // at the app general VAT rate (specs/cash-complement-and-endofstay-finance.md §3.1). Excluded
        // when paid in cash.
        if (inMonth(row.endOfStayComplementPaid, row.endOfStayComplementPaidDate) && Number(row.endOfStayComplementPaidCash || 0) === 0) {
          entries.push(buildEndOfStayEntry(row, commissionContext.vatRate));
        }
        // « Notes en séjour » (specs/mid-stay-notes.md §3.4 rule 14): one entry per SETTLED note, at
        // its own payment date — the note IS the real-world collection. Same flat-TTC shape as the
        // end-of-stay complement; caisse-interne notes stay off the books like the cash complements.
        for (const note of parseNotes(row.midStaySettledNotes)) {
          if (Number(note.paidCash || 0) === 1) continue;
          if (!inMonth(1, note.paidDate)) continue;
          entries.push(buildMidStayNoteEntry(row, note, commissionContext.vatRate));
        }
        // Pure-tax entries are dropped (see `buildEntry`).
        return entries.filter(Boolean);
      });
    },

    // Remboursements of the month (specs/reservation-refunds.md §3.4): one REVERSED entry per
    // non-`internal` refund whose `refundDate` falls in the month. Same entry shape as an
    // encaissement — `direction: 'refund'` is what flips the debit/credit sides at export time.
    refundsByMonth({ month, year }) {
      const mm = String(month).padStart(2, '0');
      const yyyy = String(year);
      const from = `${yyyy}-${mm}-01`;
      const nextMonth = Number(mm) === 12 ? `${Number(yyyy) + 1}-01-01` : `${yyyy}-${String(Number(mm) + 1).padStart(2, '0')}-01`;
      return refunds.listByMonth({ from, nextMonth }).map(buildRefundEntry).filter(Boolean);
    },
  };
}

// One refund → one avoir entry. Revenue lines are grouped per (bucket, frozen VAT rate) and split
// HT/VAT at that rate; tourist-tax lines ride the 46710000 pass-through with no VAT, exactly like the
// tax portion of an encaissement. No commission, ever (rule 23): the owner refunds the guest directly.
function buildRefundEntry(refund) {
  const lines = refund.lines || [];
  const ttc = round2(refund.totalTtc);
  if (ttc <= 0) return null;

  const byBucket = new Map(); // `${bucket}|${rate}` → { name, ttc, ratePercent }
  let taxTtc = 0;
  for (const line of lines) {
    const amount = round2(line.amountTtc);
    if (amount <= 0) continue;
    if (line.bucket === 'touristTax') { taxTtc = round2(taxTtc + amount); continue; }
    const rate = Number(line.vatRate || 0);
    const mapKey = `${line.bucket}|${rate}`;
    const current = byBucket.get(mapKey) || { name: line.bucket, ttc: 0, ratePercent: rate };
    current.ttc = round2(current.ttc + amount);
    byBucket.set(mapKey, current);
  }

  const buckets = [...byBucket.values()]
    .map((b) => bucketFromTtc(b.name, b.ttc, b.ratePercent))
    .filter((b) => b.ht > 0 || b.vat > 0);

  return {
    reservationId: refund.reservationId,
    refundId: refund.id,
    kind: 'refund',
    direction: 'refund',
    paidDate: refund.refundDate,
    client: { firstName: refund.firstName || '', lastName: refund.lastName || '' },
    propertyName: refund.propertyName || '',
    platform: refund.platform || 'direct',
    clientGrossAmount: null,
    finalPrice: ttc,
    encaissementTtc: ttc,
    encaissementNetTtc: ttc,
    commission: null,
    taxTtc,
    fraction: 1,
    buckets,
    reason: refund.reason || '',
    method: refund.method,
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


// Read the per-line contribs + current totals for one reservation. Used by `buildEntry` to
// drive the contrib-based per-bucket attribution (spec force-item-to-complement.md §5).
function buildPerLineData(database, row) {
  const optionLines = database.prepare(`
    SELECT optionId, totalPrice, COALESCE(offered, 0) AS offered,
      COALESCE(inComplement, 0) AS inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_options WHERE reservationId = ?
  `).all(row.id);
  const customOptionLines = database.prepare(`
    SELECT id AS customOptionId, description AS title,
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
  const accommodationTtcCurrent = Math.max(0, round2(Number(row.finalPrice || 0) - optionsCurrentTotal - resourcesCurrentTotal));

  // specs/mid-stay-extras-to-end-of-stay-complement.md §3.4 rule 16 — the part of a line sold DURING
  // the stay is billed by the flat `endOfStayComplement` entry, so it must leave the `complement`
  // entry: otherwise that entry credits option revenue its (frozen) debit doesn't carry.
  const midStay = resolveMidStaySplit(
    [...optionLines, ...customOptionLines.map((l) => ({ ...l, isCustom: true })), ...resourceLines],
    {
      baseline: row.arrivalExtrasBaseline,
      settled: Number(row.endOfStayComplementPaid || 0) === 1 || Number(row.endOfStayComplementPaidCash || 0) === 1,
      storedLines: storedMidStayLines(row.endOfStayComplementDetail),
    },
  );

  return {
    optionLines, customOptionLines, resourceLines, hasContribs, accommodationTtcCurrent,
    midStayByKey: midStay.byKey,
    optionsTtc: round2(optionsCurrentTotal),
    resourcesTtc: round2(resourcesCurrentTotal),
  };
}

// Shape an entry the export engine consumes.
//
// Two bucket paths (spec force-item-to-complement.md §5):
//   1. **Contrib-driven (preferred)**: when ANY per-line `acompteContribTtc` / `soldeContribTtc`
//      is non-NULL on the reservation, we trust those snapshots and the reservation-level
//      `accommodation*ContribTtc` / `touristTax*ContribTtc`. The bucket TTC for `deposit` is
//      `sum(option/resource/custom.acompteContribTtc) + accommodationAcompteContribTtc`. For
//      `balance` we use `soldeContribTtc`. For `complement` we compute `currentTotal − acompte −
//      solde` per line (= the post-payment growth) plus the forced lines at 100 % plus the
//      forced tax portion. Zero cross-contamination across kinds; `fraction = 1` (the export
//      multiplies by 1 and writes the values as-is).
//   2. **Stored-money fallback**: when all per-line contribs are NULL, full-reservation buckets
//      from the persisted line totals, multiplied export-side by `fraction` = the échéance's
//      effective share of the séjour.
//
// Tourist tax never hits a revenue account. When the reservation routes the tax to complement
// (`collectedOnArrival` OR `touristTaxInComplement = 1`) the complement carries it on the
// 46710000 pass-through; otherwise it rides entirely on the solde (specs/tourist-tax-on-solde.md).
//
// Returns `null` when there is nothing to book (zero stored amount, or a contrib entry whose
// buckets and tax are all zero).
//
// specs/accounting-encaissement-effective-percent.md — money resolution:
//   - CA (`encaissementTtc`) = the STORED échéance amount × gross-up ratio. The ratio is 1 for
//     every reservation written by the current engine (schedule sums to finalPrice + tax), so
//     stored amounts pass through unscaled; it only grosses up the two historical shapes
//     (« solde = net » era, `clientGrossAmount` era) to what the guest actually paid.
//   - Net perçu = CA − this échéance's commission → the CCLIENT debit (= bank movement). The
//     commission HT debit + optional VAT debit absorb the gap so Σ debits = Σ credits = CA.
//   - Revenue buckets derive from the STORED row money (finalPrice + persisted line totals),
//     never from a recomputed quote (pricing-rule drift corrupted the credit lines otherwise).
//
// `taxContext.collectedOnArrival` is resolved by the caller (no quote recompute); pure-function
// callers (unit tests) inject it directly.
function buildEntry(row, kind, perLineData, commissionContext, taxContext) {
  const finalPriceTtc = Number(row.finalPrice || 0);
  const touristTaxTotal = Number(row.touristTaxTotal || 0);
  const collectedOnArrival = Boolean(taxContext && taxContext.collectedOnArrival);
  const taxRoutedToComplement = collectedOnArrival || Number(row.touristTaxInComplement || 0) === 1;
  // specs/per-platform-tourist-tax-three-way.md — case 1 "platform reverses the tax to us" is now a
  // REAL charge stored in `row.touristTaxTotal` and scheduled in the balance (the platform pays it
  // with the settlement). So the standard tax-in-balance path books it on 46710000 with no special
  // casing: the offered case (platform remits to the commune itself) is the only one with tax = 0.

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

  const storedAmountTtc = amountByKind[kind] || 0;

  // Defensive null-return for the (rare) case of a `*Paid = 1 + *PaidDate in month` but
  // `*Amount = 0`. Real-world cause: a reservation toggled `depositDisabled = ON` after the
  // user had already clicked "Marquer acompte payé" — depositPaid stays 1 but depositAmount
  // collapses to 0. Same idea for an accidentally-flipped complementPaid on a reservation
  // with no actual complement to perceive. Without this guard the entry was still emitted
  // (the legacy fallback path had no `null`-return for zero-revenue entries — only the
  // contrib-driven path did), producing a phantom "tout à zéro" row in the platforms table
  // + a balanced-but-empty card in the journal preview. See spec accountant-accounting-
  // export.md §3.4 rule 12bis.
  if (storedAmountTtc === 0) return null;

  // Gross/net resolution + commission for this entry (§3.5, revised 2026-06-21).
  // The platform commission is now operator-entered (`platformCommissionAmount`); « Prix payé par le
  // client » was retired. Two modes:
  //   - NEW (commission entered): the client pays the **total séjour** (= finalPrice), so CA is
  //     recognised on finalPrice (grossRatio = 1), the commission rides on the balance debit, and the
  //     net = finalPrice − commission (= the solde the engine now stores, spec platform-commission-line.md).
  //   - LEGACY fallback (no entered commission but a stored `clientGrossAmount` > net): keep the old
  //     gross-based recognition so already-booked platform reservations are unchanged.
  // Direct → gross === net (= finalPrice), no commission.
  const platformIsNonDirect = String(row.platform || 'direct').toLowerCase() !== 'direct';
  // specs/platform-per-echeance-commission.md — per-échéance platform commission: the acompte commission
  // books on the deposit entry, the solde commission (`platformCommissionAmount`) on the balance entry.
  const acompteCommissionTtc = platformIsNonDirect ? round2(Math.max(0, Number(row.acompteCommissionAmount || 0))) : 0;
  const soldeCommissionTtc = platformIsNonDirect ? round2(Math.max(0, Number(row.platformCommissionAmount || 0))) : 0;
  const enteredCommissionTtc = round2(acompteCommissionTtc + soldeCommissionTtc);
  let effectiveGross;
  let commissionTtcTotal;
  let grossRatio;
  if (enteredCommissionTtc > 0) {
    // Entered-commission model: the guest pays the schedule GROSS (deposit + balance + complement =
    // finalPrice + tourist tax — what the current engine stores); the commission is operator-entered
    // per échéance. `grossRatio` grosses the stored amounts up to what the guest actually paid:
    // (finalPrice + touristTaxTotal) / storedSum. For every current-model reservation that's exactly
    // 1 → stored amounts pass through UNSCALED. Prod bug 2026-07-15 (resa #22224, Thomas): the old
    // numerator was bare `finalPrice`, so a tax-in-schedule reservation had ratio 131,28/134,26 and
    // its 67,13 € acompte displayed as 65,64 €. Rows from the « solde = net » era (sum = finalPrice −
    // commission, e.g. prod #7) keep a ratio > 1 and gross up to the guest-paid total, as before.
    commissionTtcTotal = enteredCommissionTtc;
    effectiveGross = finalPriceTtc;
    const storedSum = round2((Number(row.depositAmount) || 0) + (Number(row.balanceAmount) || 0) + (Number(row.complementAmount) || 0));
    grossRatio = storedSum > 0 ? (finalPriceTtc + touristTaxTotal) / storedSum : 1;
  } else {
    // LEGACY fallback: commission derived from the stored `clientGrossAmount` (> net); the stored amounts
    // summed to finalPrice (not reduced), so the ratio grosses them up to the gross.
    effectiveGross = Math.max(
      finalPriceTtc,
      Number(row.clientGrossAmount != null ? row.clientGrossAmount : finalPriceTtc) || 0,
    );
    commissionTtcTotal = round2(Math.max(0, effectiveGross - finalPriceTtc));
    grossRatio = finalPriceTtc > 0 ? effectiveGross / finalPriceTtc : 1;
  }
  // specs/platform-per-echeance-commission.md — explicit per-échéance allocation: the operator-entered
  // acompte commission rides on the deposit entry, the solde commission on the balance entry; the
  // complement carries none (on-site / host-billed). For a no-acompte platform the acompte commission is
  // 0 → the whole `platformCommissionAmount` lands on the solde (backward-compatible with the prior model).
  // The balance carries `commissionTtcTotal − acompteCommission`: in the entered-commission path that's
  // exactly the solde commission; in the LEGACY path (commission derived from `clientGrossAmount`, no
  // acompte commission) it's the whole derived commission — both correct, both backward-compatible.
  const platformCommissionByKind = {
    deposit:    acompteCommissionTtc,
    balance:    round2(commissionTtcTotal - acompteCommissionTtc),
    complement: 0,
  };
  const commissionTtcEntry = platformIsNonDirect ? (platformCommissionByKind[kind] || 0) : 0;
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

  // ── Shared money resolution (spec rules 2–5) ────────────────────────────
  // CA = stored échéance × ratio (ratio = 1 for current-model rows). Net = CA − commission.
  const encaissementTtc = round2(storedAmountTtc * grossRatio);
  // Tourist tax carried by this échéance — part of the CA (the guest paid it) but credited to
  // the 46710000 pass-through, never a 70xxx revenue line.
  const taxTtc = computeTaxTtcForKind(row, kind, taxRoutedToComplement, encaissementTtc);
  const encaissementNetTtc = round2(encaissementTtc - (commissionLine ? commissionLine.ttc : 0));
  // Single global sales VAT rate (specs/single-vat-rate.md) — same one the quote carried.
  const vatRate = commissionContext && Number.isFinite(Number(commissionContext.vatRate))
    ? Number(commissionContext.vatRate)
    : 10;

  const common = {
    reservationId: row.id,
    kind,
    paidDate: dateByKind[kind] || null,
    client: { firstName: row.firstName || '', lastName: row.lastName || '' },
    propertyName: row.propertyName || '',
    platform: row.platform || 'direct',
    finalPrice: finalPriceTtc,
    encaissementTtc,
    encaissementNetTtc,
    commission: commissionLine,
    taxTtc: round2(taxTtc),
  };

  // `perLineData` is optional: when omitted (legacy callers / unit tests that don't model the
  // contrib columns) the fallback path runs with empty line totals.
  const hasContribs = Boolean(perLineData && perLineData.hasContribs);

  // ── Contrib-driven path ─────────────────────────────────────────────────
  // Bucket TTCs are the per-line snapshots captured at flip time from the money actually paid —
  // used AS-IS (the former × grossRatio scaling distorted them; spec rule 10). `fraction = 1`:
  // the export engine multiplies by 1 and writes the values verbatim, the ≤ 2-cent residue
  // being absorbed on the last credit so Σ credits = CA.
  if (hasContribs) {
    const ttcByBucket = computeBucketTtcsFromContribs(row, perLineData, kind, taxRoutedToComplement);
    const totalBucketsTtc = round2(ttcByBucket.accommodation + ttcByBucket.options + ttcByBucket.resources + taxTtc);
    // Nothing to credit (e.g. a complement whose lines all contributed 0) → drop the entry,
    // a debit-only card can never balance.
    if (totalBucketsTtc === 0) return null;

    const buckets = [
      bucketFromTtc('accommodation', ttcByBucket.accommodation, vatRate),
      bucketFromTtc('options',       ttcByBucket.options,       vatRate),
      bucketFromTtc('resources',     ttcByBucket.resources,     vatRate),
    ].filter((b) => b.ht > 0 || b.vat > 0);

    return {
      ...common,
      clientGrossAmount: round2(effectiveGross),
      fraction: 1,
      buckets,
    };
  }

  // ── Stored-money fallback (no per-line contribs) ────────────────────────
  // Full-reservation buckets from the PERSISTED line totals (offered lines are stored at 0);
  // the export engine multiplies each bucket by `fraction` = the échéance's effective share of
  // the séjour (spec rules 6–8). Immune to pricing-rule drift by construction — the former
  // quote-recompute buckets are gone.
  const optionsTtc = perLineData ? Number(perLineData.optionsTtc || 0) : 0;
  const resourcesTtc = perLineData ? Number(perLineData.resourcesTtc || 0) : 0;
  const accommodationTtc = Math.max(0, round2(finalPriceTtc - optionsTtc - resourcesTtc));
  const revenueTtc = Math.max(0, round2(encaissementTtc - taxTtc));

  let fraction;
  let buckets;
  if (finalPriceTtc > 0) {
    // Effective percent: deposit = depositAmount / finalPrice (= the property's depositPercent
    // whenever the deposit was automatic); balance = (balance − tax) / finalPrice; etc.
    fraction = revenueTtc / finalPriceTtc;
    buckets = [
      bucketFromTtc('accommodation', accommodationTtc, vatRate),
      bucketFromTtc('options',       optionsTtc,       vatRate),
      bucketFromTtc('resources',     resourcesTtc,     vatRate),
    ].filter((b) => b.ht > 0 || b.vat > 0);
  } else {
    // Defensive: blank-price row (iCal import never priced) with real money paid — book the
    // whole revenue share as accommodation so the entry still balances.
    fraction = 1;
    buckets = [bucketFromTtc('accommodation', revenueTtc, vatRate)].filter((b) => b.ht > 0 || b.vat > 0);
  }

  return {
    ...common,
    clientGrossAmount: row.clientGrossAmount == null ? null : Number(row.clientGrossAmount),
    fraction,
    buckets,
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

// « Note en séjour » (specs/mid-stay-notes.md §3.4 rule 14): one punctual collection during the
// stay, booked exactly like the end-of-stay complement — flat TTC split at the app general VAT rate
// on the « prestation complémentaire » revenue account, collected on site (no platform commission,
// no tourist tax). One entry per note, at the note's own payment date.
function buildMidStayNoteEntry(row, note, vatRate) {
  const ttc = round2(Number(note && note.total) || 0);
  if (ttc <= 0) return null;
  const b = bucketFromTtc('options', ttc, Number(vatRate || 0));
  return {
    reservationId: row.id,
    kind: 'midStayComplement',
    paidDate: note.paidDate || null,
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
function computeTaxTtcForKind(row, kind, taxRoutedToComplement, encaissementTtc) {
  const total = round2(nz(row.touristTaxTotal));
  const cap = Number(encaissementTtc) > 0 ? Number(encaissementTtc) : total;
  if (taxRoutedToComplement) {
    // Collected on arrival / forced to complement: the tax is never on the acompte or the solde.
    // The complement carries whatever is left after the (always-zero) deposit + balance shares,
    // clamped to the complement's own CA as a defensive guard.
    if (kind !== 'complement') return 0;
    const inDeposit = nz(row.touristTaxAcompteContribTtc);
    const inBalance = nz(row.touristTaxSoldeContribTtc);
    return round2(Math.min(Math.max(0, total - inDeposit - inBalance), cap));
  }
  // specs/tourist-tax-on-solde.md — when the tax rides the pre-arrival schedule it is booked
  // ENTIRELY on the SOLDE, never the acompte. We force this regardless of the stored per-bucket
  // contribs: legacy reservations whose acompte flip captured a proportional tax share (before
  // this rule shipped) must still show 0 tax on the deposit and the full tax on the balance.
  // The balance CA is always ≥ the tax (balance = accommodation remainder + tax), so the
  // clamp is only a defensive guard.
  if (kind === 'deposit') return 0;
  if (kind === 'balance') return round2(Math.min(total, cap));
  return 0;
}

// Aggregate the per-line/per-portion TTCs for a single entry kind. Tax is always excluded.
function computeBucketTtcsFromContribs(row, perLineData, kind, taxRoutedToComplement) {
  const accommodationAcompte = nz(row.accommodationAcompteContribTtc);
  const accommodationSolde   = nz(row.accommodationSoldeContribTtc);
  const accommodationTtcCurrent = perLineData.accommodationTtcCurrent;

  // specs/tourist-tax-on-solde.md — the tax is booked 100 % on the solde. A legacy reservation
  // whose acompte flip captured a proportional tax share (`touristTaxAcompteContribTtc > 0`)
  // physically collected that tax with the deposit. To keep both entries bank-matched while the
  // tax line rides entirely on the balance, we reclass that share out of the tax line and into the
  // accommodation bucket of the deposit (it stays in the deposit's encaissement) and remove the
  // same amount from the balance's accommodation (so balance = remainder + the FULL tax). For
  // reservations booked under the new rule the share is 0, so this is a no-op.
  const taxAcompteReclass = taxRoutedToComplement ? 0 : nz(row.touristTaxAcompteContribTtc);

  if (kind === 'deposit') {
    return {
      accommodation: round2(accommodationAcompte + taxAcompteReclass),
      options:       round2(sumContribField(perLineData.optionLines, 'acompteContribTtc')
                          + sumContribField(perLineData.customOptionLines, 'acompteContribTtc')),
      resources:     round2(sumContribField(perLineData.resourceLines, 'acompteContribTtc')),
    };
  }
  if (kind === 'balance') {
    return {
      accommodation: round2(Math.max(0, accommodationSolde - taxAcompteReclass)),
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
  const remainingMidStay = { ...(perLineData.midStayByKey || {}) };
  const optionsTtc = sumComplementContribution(perLineData.optionLines, remainingMidStay)
    + sumComplementContribution(perLineData.customOptionLines, remainingMidStay, true);
  const resourcesTtc = sumComplementContribution(perLineData.resourceLines, remainingMidStay);
  const accommodationDelta = Math.max(0, accommodationTtcCurrent - (accommodationAcompte + accommodationSolde));
  return {
    accommodation: round2(accommodationDelta),
    options:       round2(optionsTtc),
    resources:     round2(resourcesTtc),
  };
}

// `remainingMidStay` carries the share of each key sold DURING the stay: that money belongs to the
// end-of-stay complement entry, never to this one (specs/mid-stay-extras-to-end-of-stay-complement.md).
// It is CONSUMED as it is deducted, so two custom lines sharing a label (hence a key) split it
// instead of each deducting the whole amount.
function sumComplementContribution(lines, remainingMidStay = {}, isCustom = false) {
  return (lines || []).reduce((sum, line) => {
    const key = extraLineKey(isCustom ? { ...line, isCustom: true } : line);
    const lineTotal = Number(line.totalPrice || 0);
    const midStay = key ? Math.min(Number(remainingMidStay[key] || 0), Math.max(0, lineTotal)) : 0;
    if (key && midStay > 0) remainingMidStay[key] = round2(Number(remainingMidStay[key]) - midStay);
    const total = Math.max(0, round2(lineTotal - midStay));
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

const defaultModel = createAccountingModel(db);
defaultModel.create = createAccountingModel;

module.exports = defaultModel;
module.exports.__test = { buildEntry };
