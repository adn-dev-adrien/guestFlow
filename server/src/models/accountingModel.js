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
 * - Reservations only, devis never exported — including the ones cancelled for non-payment
 *   (`kind='cancelled'`), whose already-booked encaissements must keep their original month
 *   (specs/payment-schedule-and-cancellation.md §3.6 rule 34).
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
const { buildModel: buildCompensationsModel } = require('./cancellationCompensationsModel');
const { DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT, DISCOUNT_ACCOUNT, TIP_ACCOUNT } = require('../constants/accounting');
const { parseComplementAllocation } = require('../utils/complementAllocation');
const { parseGroup } = require('../utils/arrivalPaymentGroup');

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
    // specs/adjustable-complement-amounts.md §3.6 — the ventilation the fiche stored for an adjusted
    // complement. Absent (or NULL) → the postes are derived exactly as before.
    hasReservationColumn('complementAllocation') ? 'r.complementAllocation' : 'NULL AS complementAllocation',
  ].join(', ');
  // specs/collect-stay-payment-at-check-in.md §3.4 rule 17 — a stay collected at the door in the
  // caisse interne is off the books, exactly like a cash complement. Guarded the same way: a schema
  // without the columns reads 0 = « nothing was collected in cash », i.e. the legacy behaviour.
  const stayCashCols = [
    hasReservationColumn('depositPaidCash') ? 'COALESCE(r.depositPaidCash, 0) AS depositPaidCash' : '0 AS depositPaidCash',
    hasReservationColumn('balancePaidCash') ? 'COALESCE(r.balancePaidCash, 0) AS balancePaidCash' : '0 AS balancePaidCash',
  ].join(', ');
  // specs/single-payment-at-check-in.md §3.3 rule 12 — the collection this entry belonged to. It
  // changes nothing about WHICH entries are emitted nor what they contain: the ventilation stays per
  // bucket (different revenue accounts, different VAT rates). It only lets the reading side say
  // « these two were one payment ».
  const paymentGroupCol = hasReservationColumn('arrivalPaymentGroup')
    ? 'r.arrivalPaymentGroup' : 'NULL AS arrivalPaymentGroup';
  // specs/arrival-payment-detail-and-adjustment.md §3.4 — what the guest actually handed over for that
  // one payment, when it differs from the buckets: a réduction accordée, or a pourboire. Each gets its
  // own entry, stamped with the same group, so the card reads « voilà ce qui a été encaissé ».
  const arrivalAdjustmentCols = [
    hasReservationColumn('arrivalPaymentReduction') ? 'r.arrivalPaymentReduction' : 'NULL AS arrivalPaymentReduction',
    hasReservationColumn('arrivalPaymentTip') ? 'r.arrivalPaymentTip' : 'NULL AS arrivalPaymentTip',
  ].join(', ');
  const depositCashFilter = hasReservationColumn('depositPaidCash') ? 'AND COALESCE(r.depositPaidCash, 0) = 0' : '';
  const balanceCashFilter = hasReservationColumn('balancePaidCash') ? 'AND COALESCE(r.balancePaidCash, 0) = 0' : '';
  // A stay whose ONLY collection of the month is a « note en séjour » must still be selected — its
  // buckets may all be paid in another month, or not at all yet (specs/mid-stay-notes.md §3.4).
  // Month prefix match on the serialised `paidDate`; `inMonth` below stays the authoritative filter.
  const hasNotesColumn = hasReservationColumn('midStaySettledNotes');
  const midStayNotesClause = hasNotesColumn ? 'OR (r.midStaySettledNotes LIKE ?)' : '';
  const midStayNotesParams = (from) => (hasNotesColumn ? [`%"paidDate":"${String(from).slice(0, 8)}%`] : []);
  // Refunds live in their own tables, so the month filter is a plain range predicate (no LIKE scan
  // like the notes register needs). Bound to the same database so the test factory covers both.
  const refunds = createRefundsModel(database);
  // Cancellation compensations (specs/cancellation-compensation.md §3.3): same lazy-statement
  // discipline as the refunds model, so a minimal test schema without the table stays buildable.
  const compensations = buildCompensationsModel(database);
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
               ${stayCashCols},
               ${paymentGroupCol},
               ${arrivalAdjustmentCols},
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
        -- specs/payment-schedule-and-cancellation.md §3.6 rule 34 — a stay cancelled for non-payment
        -- keeps kind = 'cancelled', which drops it from every operational read at once. Accounting
        -- is the one deliberate exception: the acompte it collected was booked in a month that may
        -- already be at the accountant's, and that month must never change. The requalification is
        -- booked in the cancellation month instead (avoir + indemnité).
        WHERE r.kind IN ('reservation', 'cancelled')
          AND (
            -- A stay collected in the caisse interne is excluded too (same rule as the complements).
            (r.depositPaid = 1 AND r.depositPaidDate >= ? AND r.depositPaidDate < ? ${depositCashFilter})
            OR
            (r.balancePaid = 1 AND r.balancePaidDate >= ? AND r.balancePaidDate < ? ${balanceCashFilter})
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
        // Cash-collected stay buckets are settled off the books → never emitted as an encaissement
        // (specs/collect-stay-payment-at-check-in.md §3.4).
        if (inMonth(row.depositPaid, row.depositPaidDate) && Number(row.depositPaidCash || 0) === 0) {
          entries.push(buildEntry(row, 'deposit', perLineData, commissionContext, taxContext));
        }
        if (inMonth(row.balancePaid, row.balancePaidDate) && Number(row.balancePaidCash || 0) === 0) {
          entries.push(buildEntry(row, 'balance', perLineData, commissionContext, taxContext));
        }
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
        // Stamp the group on the entries it named, so the Comptabilité can render one card for one
        // collection. A cash group emits no entry at all (its buckets are off the books), so there is
        // nothing to stamp there.
        const group = parseGroup(row.arrivalPaymentGroup);
        if (group) {
          const id = `${row.id}:${group.at}`;
          for (const entry of entries) {
            if (entry && group.buckets.includes(entry.kind)) {
              entry.paymentGroup = { id, at: group.at, cash: group.cash === 1, total: group.total };
            }
          }
          // specs/arrival-payment-detail-and-adjustment.md rules 24-27 — the adjustment of that
          // payment, at ITS date. A caisse-interne group is off the books whole: its buckets emit
          // nothing, so neither may its réduction (it would credit back money the journal never
          // booked).
          if (group.cash === 0 && group.at >= from && group.at < nextMonth) {
            const stamp = { id, at: group.at, cash: false, total: group.total };
            const adjustments = buildArrivalAdjustmentEntries(row, group, commissionContext.vatRate);
            for (const entry of adjustments) entries.push({ ...entry, paymentGroup: stamp });
          }
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

    // Indemnités d'annulation encaissées dans le mois (specs/cancellation-compensation.md §3.3
    // rule 15): one entry per compensation whose `receivedDate` falls in the month. A `pending`
    // compensation is NOT accounting — no money moved yet, so it never reaches this list.
    // The account + VAT rate are read once here so `utils/accountingExport` stays pure.
    compensationsByMonth({ month, year }) {
      // A minimal test schema (several accounting suites build one by hand) has no compensations
      // table; an export run there simply has no indemnity to report.
      if (!hasTable(database, 'cancellation_compensations')) return [];
      const mm = String(month).padStart(2, '0');
      const yyyy = String(year);
      const from = `${yyyy}-${mm}-01`;
      const nextMonth = Number(mm) === 12 ? `${Number(yyyy) + 1}-01-01` : `${yyyy}-${String(Number(mm) + 1).padStart(2, '0')}-01`;
      // Read from the INJECTED database, not the module-level settings model: an export run built
      // on a test/replica DB must use that DB's chart of accounts, never production's.
      const settings = readCompensationSettings(database);
      const { account, vatRatePercent } = settings;
      return compensations.listReceivedByMonth({ from, nextMonth })
        .map((row) => buildCompensationEntry(row, { account, vatRatePercent }))
        .filter(Boolean);
    },
  };
}

function hasTable(database, name) {
  try {
    return database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) != null;
  } catch {
    return false;
  }
}

// Chart-of-accounts settings for compensations, straight from the given database. Falls back to the
// shipped defaults (75880000 / 0 %) when the columns predate the migration.
function readCompensationSettings(database) {
  let row = null;
  try {
    row = database.prepare('SELECT cancellationCompensationAccount, vatRateCancellationCompensation FROM app_settings WHERE id = 1').get();
  } catch {
    row = null;
  }
  return {
    account: (row && row.cancellationCompensationAccount) || DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT,
    vatRatePercent: row && row.vatRateCancellationCompensation != null ? Number(row.vatRateCancellationCompensation) : 0,
  };
}

// One received compensation → one sale-shaped entry: the platform pays us, so the money moves in
// the same direction as an encaissement. No commission (the amount saved IS the net wired), no
// tourist tax (a cancelled stay generates none), no buckets (there is no séjour to split).
function buildCompensationEntry(compensation, { account, vatRatePercent }) {
  const ttc = round2(compensation.receivedAmount);
  if (ttc <= 0) return null;
  const rate = Number(vatRatePercent) || 0;
  // At 0 % (the default: an indemnity is outside the scope of VAT) HT === TTC and the export emits
  // a single credit line.
  const ht = rate > 0 ? round2(ttc / (1 + rate / 100)) : ttc;
  return {
    compensationId: compensation.id,
    reservationId: compensation.reservationId,
    kind: 'compensation',
    direction: 'compensation',
    paidDate: compensation.receivedDate,
    client: { firstName: compensation.clientFirstName || '', lastName: compensation.clientLastName || '' },
    propertyName: compensation.propertyName || '',
    platform: compensation.platform || '',
    clientGrossAmount: null,
    finalPrice: ttc,
    encaissementTtc: ttc,
    encaissementNetTtc: ttc,
    commission: null,
    taxTtc: 0,
    fraction: 1,
    buckets: [],
    compensation: {
      account,
      ht,
      vat: round2(ttc - ht),
      ratePercent: rate,
      expectedAmount: compensation.expectedAmount,
      startDate: compensation.startDate || '',
      endDate: compensation.endDate || '',
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
    destinations: splitByDestination({ optionLines, customOptionLines, resourceLines }, midStay.byKey),
  };
}

// Where each billed line is COLLECTED (specs/accounting-books-the-money-collected.md rule 5). One line
// belongs to exactly one encaissement: pre-arrival (acompte + solde), arrival complement, or — for the
// share sold during the stay — the flat end-of-stay complement, which bills it separately.
//
// This is what lets an entry credit the extras it actually carries instead of a pro-rata slice of every
// line on the reservation. Offered lines (0 €) are skipped: they can never be billed anywhere.
function splitByDestination({ optionLines, customOptionLines, resourceLines }, midStayByKey) {
  const remainingMidStay = { ...(midStayByKey || {}) };
  const totals = { preArrivalOptions: 0, preArrivalResources: 0, complementOptions: 0, complementResources: 0 };

  const classify = (lines, { isCustom = false, isResource = false } = {}) => {
    for (const line of (lines || [])) {
      if (Number(line.offered || 0) === 1) continue;
      const lineTotal = Math.max(0, nz(line.totalPrice));
      if (lineTotal === 0) continue;
      // The mid-stay share is consumed as it is deducted, so two lines sharing a key split it.
      const key = extraLineKey(isCustom ? { ...line, isCustom: true } : line);
      const midStay = key ? Math.min(nz(remainingMidStay[key]), lineTotal) : 0;
      if (key && midStay > 0) remainingMidStay[key] = round2(nz(remainingMidStay[key]) - midStay);
      const collectedHere = round2(lineTotal - midStay);
      if (collectedHere <= 0) continue; // sold entirely mid-stay → billed by the end-of-stay entry
      const inComplement = Number(line.inComplement || 0) === 1;
      const bucket = inComplement
        ? (isResource ? 'complementResources' : 'complementOptions')
        : (isResource ? 'preArrivalResources' : 'preArrivalOptions');
      totals[bucket] = round2(totals[bucket] + collectedHere);
    }
  };

  classify(optionLines);
  classify(customOptionLines, { isCustom: true });
  classify(resourceLines, { isResource: true });
  return totals;
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
/**
 * The two entries a single arrival payment can carry beyond its buckets
 * (specs/arrival-payment-detail-and-adjustment.md §3.4).
 *
 * A **réduction accordée** is the operator giving up part of the accommodation at the door. The sale
 * entries keep their gross credits — the accommodation IS worth what it is worth — and the rebate
 * carries its own debit on `70900000`, the PCG account for exactly that. Reading the journal, the
 * operator sees the price AND the gesture, instead of a smaller price with no explanation.
 *
 * A **pourboire** is money with no prestation in front of it: produit divers de gestion courante,
 * hors TVA.
 *
 * Both are dated on the GROUP's date — they belong to the collection, not to the day the operator got
 * round to recording them.
 */
function buildArrivalAdjustmentEntries(row, group, vatRate) {
  const out = [];
  const common = {
    reservationId: row.id,
    paidDate: group.at,
    client: { firstName: row.firstName || '', lastName: row.lastName || '' },
    propertyName: row.propertyName || '',
    platform: row.platform || 'direct',
    finalPrice: round2(row.finalPrice),
    taxTtc: 0,
    commission: null,
    buckets: [],
    fraction: 1,
  };
  const reduction = round2(row.arrivalPaymentReduction);
  if (reduction > 0) {
    const rate = Number.isFinite(Number(vatRate)) ? Number(vatRate) : 10;
    const ht = round2(reduction / (1 + rate / 100));
    out.push({
      ...common,
      kind: 'discount',
      direction: 'discount',
      encaissementTtc: reduction,
      encaissementNetTtc: reduction,
      discount: { account: DISCOUNT_ACCOUNT, ttc: reduction, ht, vat: round2(reduction - ht), ratePercent: rate },
    });
  }
  const tip = round2(row.arrivalPaymentTip);
  if (tip > 0) {
    out.push({
      ...common,
      kind: 'tip',
      direction: 'tip',
      encaissementTtc: tip,
      encaissementNetTtc: tip,
      tipAccount: TIP_ACCOUNT,
      // The account is shared with the indemnité d'annulation, so this entry names its own use of it.
      accountLabels: { [TIP_ACCOUNT]: 'Pourboire' },
    });
  }
  return out;
}

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
  // specs/adjustable-complement-amounts.md §3.6 — the ventilation the fiche stored for an adjusted
  // arrival complement, read (never re-derived) further down, and used right below to keep the
  // gross-up ratio from reacting to the adjustment.
  const storedAllocation = parseComplementAllocation(row.complementAllocation);
  const adjustedComplementAuto = storedAllocation ? storedAllocation.auto : null;

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
    // specs/adjustable-complement-amounts.md §3.6 rule 37 — the gross-up exists to repair two
    // HISTORICAL schedule shapes, not to react to an operator decision. An adjusted complement is a
    // deliberate deviation from the schedule, so the denominator keeps the complement the engine
    // produced: without this, lowering a complement would re-inflate its own entry AND the acompte
    // and solde entries of the same reservation.
    const scheduledComplement = adjustedComplementAuto != null
      ? adjustedComplementAuto
      : (Number(row.complementAmount) || 0);
    // specs/accounting-books-the-money-collected.md rules 1-2 — the end-of-stay complement is scheduled
    // money too. Leaving it out made the denominator short by whatever was sold mid-stay, so every entry
    // of such a stay was grossed up by that amount (Carpier #22275: +29,42 € of CA, +25,47 € on the
    // client's debit) and cash-settled complements leaked back into the books through the same ratio.
    const scheduledTotal = round2((Number(row.depositAmount) || 0) + (Number(row.balanceAmount) || 0)
      + scheduledComplement + (Number(row.endOfStayComplementAmount) || 0));
    const expectedTotal = round2(finalPriceTtc + touristTaxTotal);
    // The ratio grosses amounts up in ONE case only: the legacy « solde = net » shape, where the stored
    // schedule is the total minus the commission (réservation #7 books 994 € of CA against a 903 €
    // transfer). A schedule that already sums to the total is booked verbatim, and so is a DRIFTED one
    // — a fiche/total inconsistency is never resolved by inventing revenue.
    const isLegacyNetSchedule = scheduledTotal > 0
      && Math.abs(scheduledTotal - expectedTotal) > 0.02
      && Math.abs(round2(scheduledTotal + commissionTtcTotal) - expectedTotal) <= 0.02;
    grossRatio = isLegacyNetSchedule ? expectedTotal / scheduledTotal : 1;
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
  // §3.6 rule 37 — on the adjusted complement itself the announced amount IS the money: it is booked
  // verbatim, never scaled. The acompte and the solde keep the ratio computed above (on the
  // un-adjusted schedule), so their entries are strictly unchanged by an adjustment.
  const complementIsAdjusted = kind === 'complement' && Boolean(storedAllocation);
  if (complementIsAdjusted) grossRatio = 1;

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
  // The tourist-tax share of an adjusted complement is the one the FICHE ventilated against — the
  // floor guarantees the complement covers it, so the credits close on the announced amount.
  const taxTtc = complementIsAdjusted && storedAllocation.tax != null
    ? round2(storedAllocation.tax)
    : computeTaxTtcForKind(row, kind, taxRoutedToComplement, encaissementTtc);
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

  // specs/adjustable-complement-amounts.md §3.6 rules 31 + 36 — an ADJUSTED arrival complement carries
  // the ventilation the FICHE decided and stored. The export reads it verbatim: it never re-derives
  // the postes, and the only arithmetic left here is the TTC → HT + VAT split. That is what keeps
  // Σ credits equal to the adjusted debit by construction, instead of letting the difference fall on
  // the last credit line — which happens to be the 46710000 tourist tax (rule 37).
  if (complementIsAdjusted) {
    const allocated = [
      bucketFromTtc('accommodation', storedAllocation.accommodation, vatRate),
      bucketFromTtc('options',       storedAllocation.options,       vatRate),
      bucketFromTtc('resources',     storedAllocation.resources,     vatRate),
    ].filter((b) => b.ht > 0 || b.vat > 0);
    // Nothing to credit at all (an adjustment to 0 with no tax) → no entry, like every other bucket.
    if (allocated.length === 0 && round2(taxTtc) === 0) return null;
    return {
      ...common,
      clientGrossAmount: round2(effectiveGross),
      fraction: 1,
      buckets: allocated,
    };
  }

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
  // specs/accounting-books-the-money-collected.md rules 5-7 — each encaissement credits ONLY the postes
  // it actually covers, pro-rated within that destination. The former model scaled the WHOLE
  // reservation's buckets by `revenue / finalPrice`, so a solde that collected pure accommodation still
  // credited a slice of every option and resource on the fiche — including extras collected at arrival,
  // at checkout, or settled in caisse interne.
  const optionsTtc = perLineData ? Number(perLineData.optionsTtc || 0) : 0;
  const resourcesTtc = perLineData ? Number(perLineData.resourcesTtc || 0) : 0;
  const accommodationTtc = Math.max(0, round2(finalPriceTtc - optionsTtc - resourcesTtc));
  const revenueTtc = Math.max(0, round2(encaissementTtc - taxTtc));
  const destinations = (perLineData && perLineData.destinations) || null;

  // Fallback for callers that don't model the line destinations (legacy unit tests): the whole
  // reservation is treated as one destination, i.e. the previous behaviour.
  const collectedHere = kind === 'complement'
    ? {
      accommodation: 0,
      options:   destinations ? destinations.complementOptions   : optionsTtc,
      resources: destinations ? destinations.complementResources : resourcesTtc,
    }
    : {
      accommodation: accommodationTtc,
      options:   destinations ? destinations.preArrivalOptions   : optionsTtc,
      resources: destinations ? destinations.preArrivalResources : resourcesTtc,
    };
  const collectedTotal = round2(collectedHere.accommodation + collectedHere.options + collectedHere.resources);

  let fraction;
  let buckets;
  if (collectedTotal > 0) {
    // Effective percent WITHIN the destination: an acompte of 30 % of the pre-arrival credits 30 % of
    // the accommodation and of the pre-arrival extras, and nothing else.
    fraction = revenueTtc / collectedTotal;
    buckets = [
      bucketFromTtc('accommodation', collectedHere.accommodation, vatRate),
      bucketFromTtc('options',       collectedHere.options,       vatRate),
      bucketFromTtc('resources',     collectedHere.resources,     vatRate),
    ].filter((b) => b.ht > 0 || b.vat > 0);
  } else if (revenueTtc > 0) {
    // Money collected with nothing to attach it to: a blank-price row (iCal import never priced) books
    // it as accommodation; an arrival complement beyond its tourist tax books it as a prestation
    // (rule 10) rather than letting the residue swell the 46710000 pass-through.
    fraction = 1;
    buckets = [kind === 'complement'
      ? bucketFromTtc('options', revenueTtc, vatRate)
      : bucketFromTtc('accommodation', revenueTtc, vatRate)].filter((b) => b.ht > 0 || b.vat > 0);
  } else {
    // Nothing but tourist tax (an owner-collect complement that carries only the tax).
    fraction = 1;
    buckets = [];
  }

  return {
    ...common,
    clientGrossAmount: row.clientGrossAmount == null ? null : Number(row.clientGrossAmount),
    fraction,
    buckets,
  };
}

// End-of-stay complement (departure SAS): a flat TTC amount outside the pricing engine — the SAS's own
// lines (ménage, linge manquant) plus whatever was sold DURING the stay. Booked at the app general VAT
// rate, collected on-site by the owner: no platform commission, no tourist tax
// (specs/cash-complement-and-endofstay-finance.md §3.1 + Q1). Returns null when there's nothing to book.
//
// specs/accounting-books-the-money-collected.md rule 8 — ventilated by stored detail line: a `res:*` key
// is a resource (70601000), everything else a prestation (70600010). Carpier's bain nordique, sold
// mid-stay, was landing on the prestations account.
function buildEndOfStayEntry(row, vatRate) {
  const ttc = round2(Number(row.endOfStayComplementAmount || 0));
  if (ttc <= 0) return null;
  const { options, resources } = splitEndOfStayDetail(row.endOfStayComplementDetail, ttc);
  const buckets = [
    bucketFromTtc('options',   options,   Number(vatRate || 0)),
    bucketFromTtc('resources', resources, Number(vatRate || 0)),
  ];
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
    buckets: buckets.filter((x) => x.ht > 0 || x.vat > 0),
  };
}

// Split an end-of-stay complement between the two revenue natures, from its stored detail lines. The
// amount is authoritative: when the detail is missing, unparsable, or doesn't add up to it (an operator
// override, a legacy row), the unattributed remainder stays on the prestations account — the historical
// behaviour, so no entry can lose money to a detail mismatch.
function splitEndOfStayDetail(detailRaw, ttc) {
  let lines = [];
  if (Array.isArray(detailRaw)) lines = detailRaw;
  else if (detailRaw) { try { const p = JSON.parse(detailRaw); if (Array.isArray(p)) lines = p; } catch { lines = []; } }
  let resources = 0;
  for (const line of lines) {
    if (!line || !String(line.key || '').startsWith('res:')) continue;
    resources = round2(resources + Math.max(0, nz(line.amount)));
  }
  resources = Math.min(resources, ttc);
  return { options: round2(ttc - resources), resources };
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
module.exports.__test = { buildEntry, buildEndOfStayEntry, splitByDestination };
