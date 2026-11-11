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
 * Factory `create(db, { settings })`; the plugin builds it on `ctx.db`. The money it reads is core
 * data: this model never writes (specs/plugins-phase-2-hosts.md rule 19).
 */

const sdk = require('../sdk');
const { taxShares } = sdk.coreModule('installmentPlan');
const {
  DEFAULT_COMMISSION_ACCOUNT, VAT_DEDUCTIBLE_COMMISSION_ACCOUNT, DISCOUNT_ACCOUNT, TIP_ACCOUNT, PLATFORM_PENALTY_ACCOUNT,
  BUCKET_TO_ACCOUNT, vatAccountForRate,
} = require('./accountPlan');
const { createAccountSettings, readTtcSplitFrom, readStayClosingFrom } = require('./settings');
const { bookedBucketSplit, entryVentilation } = require('./accountingExport');

const { isPlatformCollectingTouristTax } = sdk.coreModule('pricing');
const vatRegimeModel = sdk.coreModule('vatRegimeModel');
const { extraLineKey, parseNotes } = sdk.coreModule('midStayExtras');
const { buildPerLineData, splitByDestination, storedMoneyCollected } = sdk.coreModule('storedMoneySplit');
const { createModel: createRefundsModel } = sdk.coreModule('refundsModel');
const { buildModel: buildCompensationsModel } = sdk.coreModule('cancellationCompensationsModel');
const { buildModel: buildPenaltiesModel } = sdk.coreModule('platformPenaltiesModel');
const { parseComplementAllocation } = sdk.coreModule('complementAllocation');
const { parseGroup } = sdk.coreModule('arrivalPaymentGroup');
const { settlementFigures, targetFigures, currentCentsOf } = sdk.coreModule('paymentTenders');
const { buildModel: buildSettlementsModel } = sdk.coreModule('paymentSettlementsModel');

// The residue the export absorbs on the last credit of a contrib-driven entry (rounding cents).
const CONTRIB_RESIDUE_TOLERANCE_TTC = 0.02;

// `settings` — the export's account and VAT settings (./settings), bound to `database` by default.
function createAccountingModel(database, { settings = createAccountSettings(database) } = {}) {
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
  const addedGuestsTaxCol = hasReservationColumn('touristTaxAddedGuestsAmount')
    ? 'r.touristTaxAddedGuestsAmount'
    : '0 AS touristTaxAddedGuestsAmount';
  const surchargeCol = hasReservationColumn('extraGuestComplementSurcharge')
    ? 'r.extraGuestComplementSurcharge'
    : '0 AS extraGuestComplementSurcharge';
  // specs/accounting-books-the-money-collected.md rules 16-17 — on a core older than these columns: « nothing stored ».
  const bookedEntryCols = [
    hasReservationColumn('complementPaidSplit') ? 'r.complementPaidSplit' : 'NULL AS complementPaidSplit',
    hasReservationColumn('removedLineContribs') ? 'r.removedLineContribs' : 'NULL AS removedLineContribs',
  ].join(', ');
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
  // specs/direct-installments.md — an installment is an encaissement of its own, at its paid date. A schema
  // without the table (a minimal test one) simply has none.
  const hasInstallments = hasTable(database, 'reservation_installments');
  const installmentClause = hasInstallments
    ? `OR EXISTS (SELECT 1 FROM reservation_installments i WHERE i.reservationId = r.id AND i.paid = 1 AND i.paidDate >= ? AND i.paidDate < ?)`
    : '';
  // specs/accounting-books-the-money-collected.md rule 14 — the split frozen when the installment was
  // collected. A schema without the column (older test fixtures) reads NULL: the live split.
  const paidSplitCol = hasInstallments && (() => {
    try { return database.prepare('PRAGMA table_info(reservation_installments)').all().some((c) => c.name === 'paidSplit'); }
    catch { return false; }
  })() ? 'paidSplit' : 'NULL AS paidSplit';
  const installmentCols = hasReservationColumn('installmentsPaidAmount')
    ? 'r.installmentsPaidAmount, r.installmentsUnpaidAmount'
    : '0 AS installmentsPaidAmount, 0 AS installmentsUnpaidAmount';
  // Refunds live in their own tables, so the month filter is a plain range predicate (no LIKE scan
  // like the notes register needs). Bound to the same database so the test factory covers both.
  const refunds = createRefundsModel(database);
  // Cancellation compensations (specs/cancellation-compensation.md §3.3): same lazy-statement
  // discipline as the refunds model, so a minimal test schema without the table stays buildable.
  const compensations = buildCompensationsModel(database);
  // Platform penalties (specs/reconciliation-assisted-matching.md rule 28), same lazy discipline.
  const penalties = buildPenaltiesModel(database);
  // specs/mixed-method-payments.md rule 26 — a payment split over several methods is booked settlement by
  // settlement, at each one's date, for its share on the books. A schema without the table has none.
  const settlementsStore = buildSettlementsModel(database);
  const hasSettlements = hasTable(database, 'payment_settlements');
  const settlementClause = hasSettlements
    ? 'OR EXISTS (SELECT 1 FROM payment_settlements s WHERE s.reservationId = r.id AND s.paidDate >= ? AND s.paidDate < ?)'
    : '';
  // Tax collected at check-in (→ complement) only when WE charge the guest directly, i.e. a non-direct platform that
  // does NOT collect the tax from the guest (case 3 « owner » of specs/per-platform-tourist-tax-three-way.md).
  // Mirrors the pricing engine's `isTouristTaxCollectedOnArrival` without recomputing a full quote.
  const taxContextOf = (row) => ({
    collectedOnArrival: String(row.platform || 'direct').toLowerCase() !== 'direct'
      && Number(row.touristTaxTotal || 0) > 0
      && !isPlatformCollectingTouristTax(database, row.propertyId, row.platform),
  });

  // specs/payment-schedule-and-cancellation.md rule 55 — what the stay's paid acompte or solde credited per
  // `${bucket}|${rate}` (TTC, HT, VAT), as its own entry books it: a cancellation's avoir mirrors it. A plan's money
  // was booked installment by installment: its acompte is read from none.
  const bookedSplitsOf = (reservationId, kind) => {
    const splits = new Map();
    const row = database.prepare(`
      SELECT r.*, c.firstName, c.lastName, p.name AS propertyName
        FROM reservations r LEFT JOIN clients c ON c.id = r.clientId LEFT JOIN properties p ON p.id = r.propertyId
       WHERE r.id = ?`).get(Number(reservationId));
    const paid = kind === 'deposit'
      ? row && Number(row.depositPaid) && !Number(row.depositPaidCash || 0) && !Number(row.installmentsPaidAmount || 0)
      : row && Number(row.balancePaid) && !Number(row.balancePaidCash || 0);
    if (!paid) return splits;
    const salesRegime = vatRegimeModel.forRow(database, row);
    const context = { ...buildCommissionContext(settings.read()), vatRate: salesRegime.rate, salesRegime: salesRegime.regime };
    const whole = buildEntry(row, kind, buildPerLineData(database, row), context, taxContextOf(row));
    // specs/mixed-method-payments.md rule 26 — a bucket paid with several methods booked only its share.
    const bookedShare = bookedShareOf(settlementsStore.listFor(row.id), kind, row);
    const entry = whole && bookedShare !== 1 ? scaleEntry(whole, bookedShare, null) : whole;
    const splitFrom = readTtcSplitFrom(database);
    for (const bucket of (entry && entry.buckets) || []) {
      const { ht, vat } = bookedBucketSplit(entry, bucket, splitFrom);
      splits.set(`${bucket.name}|${Number(bucket.ratePercent || 0)}`, { ttc: round2(ht + vat), ht, vat });
    }
    return splits;
  };

  // Every encaissement paid in [from, nextMonth): of the month, or (`reservationId`) of one stay over any window — the
  // books a closing refund settles (specs/mixed-method-payments.md rule 56).
  const encaissementsIn = (from, nextMonth, reservationId = null) => {
      const oneStay = reservationId != null;
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
               ${addedGuestsTaxCol}, ${surchargeCol}, ${bookedEntryCols},
               r.accommodationAcompteContribTtc, r.accommodationSoldeContribTtc,
               r.touristTaxAcompteContribTtc, r.touristTaxSoldeContribTtc,
               ${installmentCols},
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
          AND ${oneStay ? 'r.id = ?' : `(
            -- A stay collected in the caisse interne is excluded too (same rule as the complements).
            (r.depositPaid = 1 AND r.depositPaidDate >= ? AND r.depositPaidDate < ? ${depositCashFilter})
            OR
            (r.balancePaid = 1 AND r.balancePaidDate >= ? AND r.balancePaidDate < ? ${balanceCashFilter})
            OR
            -- Cash-flagged complements are excluded from accounting (paid « en liquide », off the books).
            (r.complementPaid = 1 AND r.complementPaidDate >= ? AND r.complementPaidDate < ? AND COALESCE(r.complementPaidCash, 0) = 0)
            OR
            (r.endOfStayComplementPaid = 1 AND r.endOfStayComplementPaidDate >= ? AND r.endOfStayComplementPaidDate < ? AND COALESCE(r.endOfStayComplementPaidCash, 0) = 0)
            ${installmentClause}
            ${midStayNotesClause}
            ${settlementClause}
          )`}
        ORDER BY COALESCE(r.depositPaidDate, r.balancePaidDate, r.complementPaidDate, r.endOfStayComplementPaidDate), r.id
      `).all(...(oneStay ? [Number(reservationId)]
        : [from, nextMonth, from, nextMonth, from, nextMonth, from, nextMonth, ...(hasInstallments ? [from, nextMonth] : []), ...midStayNotesParams(from), ...(hasSettlements ? [from, nextMonth] : [])]));

      // Read the global commission config once per export run (settings + platforms).
      // accounting-platform-commission-and-no-deposit.md §3.5 rule 11.
      const commissionContext = buildCommissionContext(settings.read());
      // A tip lands on the plan's tip account (specs/plugins-phase-p-productisation.md rule 27): its
      // default is shared with the compensation account, so the entry names it.
      const tipAccount = String(settings.read().tipAccount || TIP_ACCOUNT);
      const inTipAccount = (entry) => (entry.kind === 'tip'
        ? { ...entry, tipAccount, accountLabels: { [tipAccount]: 'Pourboire' } }
        : entry);

      return reservations.flatMap((row) => {
        const salesRegime = vatRegimeModel.forRow(database, row);
        const rowContext = { ...commissionContext, vatRate: salesRegime.rate, salesRegime: salesRegime.regime };
        const perLineData = buildPerLineData(database, row);
        const taxContext = taxContextOf(row);
        const entries = [];
        const inMonth = (paid, date) => paid && date && date >= from && date < nextMonth;
        // specs/mixed-method-payments.md rule 26 — what a split payment paid is booked by its settlements below,
        // never a second time as a whole bucket, note or installment.
        const settlements = settlementsStore.listFor(row.id);
        const split = splitTargetsOf(settlements);
        // Cash-collected stay buckets are settled off the books → never emitted as an encaissement
        // (specs/collect-stay-payment-at-check-in.md §3.4).
        if (inMonth(row.depositPaid, row.depositPaidDate) && Number(row.depositPaidCash || 0) === 0 && !split.buckets.has('deposit')) {
          entries.push(buildEntry(row, 'deposit', perLineData, rowContext, taxContext));
        }
        if (inMonth(row.balancePaid, row.balancePaidDate) && Number(row.balancePaidCash || 0) === 0 && !split.buckets.has('balance')) {
          entries.push(buildEntry(row, 'balance', perLineData, rowContext, taxContext));
        }
        // One encaissement per installment collected in the month (specs/direct-installments.md): the plan
        // replaces the acompte and the solde, so these are the pre-arrival money of such a stay.
        const plan = hasInstallments
          ? database.prepare(`SELECT id, number, amountCents, paidDate, paid, ${paidSplitCol} FROM reservation_installments WHERE reservationId = ? ORDER BY number`).all(row.id)
          : [];
        // The tax shares are those of the whole plan, so they add up to the tax once every installment is in.
        // specs/platform-added-guests-tourist-tax.md rule 27 — without the added guests' share: it rides the complement.
        const shares = plan.length
          ? taxShares(Math.round((Number(row.touristTaxTotal || 0) - Number(row.touristTaxAddedGuestsAmount || 0)) * 100), plan.map((i) => Number(i.amountCents)))
          : [];
        const installmentEntry = (installment) => {
          const index = plan.indexOf(installment);
          return buildInstallmentEntry(row, installment, plan.length, shares[index] / 100, perLineData, rowContext, taxContext);
        };
        plan.forEach((installment) => {
          if (Number(installment.paid) === 1 && inMonth(1, installment.paidDate) && !split.installments.has(String(installment.id))) {
            entries.push(installmentEntry(installment));
          }
        });
        // Cash complements are settled off the books → never emitted as an encaissement.
        if (inMonth(row.complementPaid, row.complementPaidDate) && Number(row.complementPaidCash || 0) === 0 && !split.buckets.has('complement')) {
          entries.push(buildEntry(row, 'complement', perLineData, rowContext, taxContext));
        }
        // End-of-stay complement (SAS): a flat TTC amount booked as a « prestation complémentaire »
        // at the app general VAT rate (specs/cash-complement-and-endofstay-finance.md §3.1). Excluded
        // when paid in cash.
        if (inMonth(row.endOfStayComplementPaid, row.endOfStayComplementPaidDate) && Number(row.endOfStayComplementPaidCash || 0) === 0 && !split.buckets.has('endOfStayComplement')) {
          entries.push(buildEndOfStayEntry(row, rowContext.vatRate));
        }
        // « Notes en séjour » (specs/mid-stay-notes.md §3.4 rule 14): one entry per SETTLED note, at
        // its own payment date — the note IS the real-world collection. Same flat-TTC shape as the
        // end-of-stay complement; caisse-interne notes stay off the books like the cash complements.
        for (const note of parseNotes(row.midStaySettledNotes)) {
          if (Number(note.paidCash || 0) === 1) continue;
          if (!inMonth(1, note.paidDate)) continue;
          if (split.notes.has(String(note.id))) continue;
          entries.push(buildMidStayNoteEntry(row, note, rowContext.vatRate));
        }
        // specs/mixed-method-payments.md rules 18, 26 — each settlement of the month: the entries of what it paid,
        // at its date, scaled to its share on the books (gross of its réduction), then the réduction itself.
        const partEntry = (part) => {
          if (part.kind === 'deposit' || part.kind === 'balance' || part.kind === 'complement') {
            return buildEntry(row, part.kind, perLineData, rowContext, taxContext);
          }
          if (part.kind === 'endOfStayComplement') return buildEndOfStayEntry(row, rowContext.vatRate);
          if (part.kind === 'note') {
            const note = parseNotes(row.midStaySettledNotes).find((n) => String(n.id) === String(part.key));
            return note ? buildMidStayNoteEntry(row, note, rowContext.vatRate) : null;
          }
          if (part.kind === 'installment') {
            const installment = plan.find((i) => String(i.id) === String(part.key));
            return installment ? installmentEntry(installment) : null;
          }
          return null;
        };
        const targetOf = targetReader(settlements, row);
        for (const settlement of settlements) {
          if (!inMonth(1, settlement.paidDate)) continue;
          const { booksCents, bookedWaivedCents, share } = bookedFigures(settlement, targetOf(settlement));
          if (share > 0) {
            for (const part of settlement.parts) {
              const entry = partEntry(part);
              if (entry) entries.push(scaleEntry(entry, share, settlement));
            }
          }
          if (bookedWaivedCents > 0) entries.push(buildSettlementDiscountEntry(row, settlement, bookedWaivedCents / 100, rowContext.vatRate));
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
            const adjustments = buildArrivalAdjustmentEntries(row, group, rowContext.vatRate);
            for (const entry of adjustments) entries.push({ ...inTipAccount(entry), paymentGroup: stamp });
          }
        }
        // Pure-tax entries are dropped (see `buildEntry`).
        return entries.filter(Boolean);
      });
  };

  // One refund's avoir (specs/reservation-refunds.md §3.4).
  const refundEntry = (row) => {
    // Rule 48 — the share a cancelled stay gives back from its indemnity debits the account the indemnity was credited
    // on, at its rate: read only when such a share exists, so a minimal test schema without settings never needs them.
    const indemnity = (row.lines || []).some((line) => line.bucket === 'indemnity') ? compensationSettings(settings.read()) : null;
    // specs/payment-schedule-and-cancellation.md rule 55 — a requalification avoir netted of the stay's earlier refunds
    // mirrors their split: read only for such an avoir, so every other entry stays byte-identical.
    const adjusted = row.method === 'retained' && (row.lines || []).some(isAdjustedLine);
    return buildRefundEntry(row, {
      indemnity: indemnity ? {
        account: indemnity.account,
        vatRatePercent: vatRegimeModel.forRow(database, { id: row.reservationId }).regime === 'not_subject' ? 0 : indemnity.vatRatePercent,
        priorTtc: refunds.indemnityGivenBefore(row),
      } : null,
      earlier: adjusted ? earlierRefundsOf(row).filter((other) => other.method !== 'retained') : null,
      solde: adjusted ? bookedSplitsOf(row.reservationId, 'balance') : null,
      deposit: row.method === 'retained' ? bookedSplitsOf(row.reservationId, 'deposit') : null,
    });
  };
  // The stay's refunds on the books before `row`, in the order they were made.
  const earlierRefundsOf = (row) => refunds.listByReservation(row.reservationId)
    .filter((other) => other.method !== 'internal'
      && (other.refundDate < row.refundDate || (other.refundDate === row.refundDate && other.id < row.id)));

  // specs/mixed-method-payments.md rule 56 (verification R35 leftovers, R34b-3) — a stay paid with several methods books
  // each settlement's share entry by entry (`scaleEntry`), its refunds line by line from the register: the two round
  // their cents apart. The refund that gives back the last of its book money therefore debits what is left on each sale
  // account instead of its lines, so every 706 / 706010 / 709 / 4457 / 4671 account of the stay ends at exactly 0.
  // Rule 58 (verification R35b, finding 2) — a stay paid with one method rounds its cents apart too: its refunds close
  // the same way from the month after this version was installed, so a month already exported keeps its cents.
  const refundEntryReader = () => {
    const memo = new Map();
    const closingFrom = readStayClosingFrom(database);
    const closes = (row) => String(row.refundDate || '') >= closingFrom
      || (hasSettlements && settlementsStore.listFor(row.reservationId).length > 0);
    const stayEntries = new Map();
    const entriesOfStay = (reservationId) => {
      if (!stayEntries.has(reservationId)) stayEntries.set(reservationId, encaissementsIn('0000-01-01', '9999-12-31', reservationId));
      return stayEntries.get(reservationId);
    };
    const entryOf = (row) => {
      if (!memo.has(row.id)) {
        const entry = refundEntry(row);
        memo.set(row.id, entry && closes(row) ? closeStayBooks(entry, row) : entry);
      }
      return memo.get(row.id);
    };
    const closeStayBooks = (entry, row) => {
      const left = new Map();
      for (const e of entriesOfStay(row.reservationId)) if (String(e.paidDate || '') <= row.refundDate) addSaleLegs(left, e);
      for (const other of earlierRefundsOf(row)) {
        const e = entryOf(other);
        if (e) addSaleLegs(left, e);
      }
      const own = addSaleLegs(new Map(), entry);
      const sum = (legs) => [...legs.values()].reduce((total, leg) => total + leg.cents, 0);
      if (sum(left) !== -sum(own)) return entry;
      const closing = [...left.entries()].filter(([, leg]) => leg.cents !== 0)
        .map(([account, leg]) => ({ account, role: leg.role, ratePercent: leg.ratePercent, amount: leg.cents / 100 }));
      return { ...entry, closing };
    };
    return entryOf;
  };

  return {
    // List every encaissement (deposit + balance) whose paid date falls in [`YYYY-MM-01`, end of month].
    // Returns enriched entries already carrying the per-bucket HT/VAT and the platform info.
    encaissementsByMonth({ month, year }) {
      const mm = String(month).padStart(2, '0');
      const yyyy = String(year);
      const from = `${yyyy}-${mm}-01`;
      // SQLite quirk: 'YYYY-MM-DD' compares lexicographically; build an exclusive upper bound.
      const nextMonth = Number(mm) === 12 ? `${Number(yyyy) + 1}-01-01` : `${yyyy}-${String(Number(mm) + 1).padStart(2, '0')}-01`;
      return encaissementsIn(from, nextMonth);
    },

    // Remboursements of the month (specs/reservation-refunds.md §3.4): one REVERSED entry per
    // non-`internal` refund whose `refundDate` falls in the month. Same entry shape as an
    // encaissement — `direction: 'refund'` is what flips the debit/credit sides at export time.
    refundsByMonth({ month, year }) {
      const mm = String(month).padStart(2, '0');
      const yyyy = String(year);
      const from = `${yyyy}-${mm}-01`;
      const nextMonth = Number(mm) === 12 ? `${Number(yyyy) + 1}-01-01` : `${yyyy}-${String(Number(mm) + 1).padStart(2, '0')}-01`;
      const entryOf = refundEntryReader();
      return refunds.listByMonth({ from, nextMonth }).map(entryOf).filter(Boolean);
    },

    // Pénalités plateforme du mois (specs/reconciliation-assisted-matching.md rule 28): one entry per
    // penalty, dated on the penalty's own date — never folded into the balance entry of the stay.
    platformPenaltiesByMonth({ month, year }) {
      // A minimal test schema has no penalties table: nothing to report there.
      if (!hasTable(database, 'reservation_platform_penalties')) return [];
      const mm = String(month).padStart(2, '0');
      const yyyy = String(year);
      const from = `${yyyy}-${mm}-01`;
      const before = Number(mm) === 12 ? `${Number(yyyy) + 1}-01-01` : `${yyyy}-${String(Number(mm) + 1).padStart(2, '0')}-01`;
      const account = String(settings.read().platformPenaltyAccount || PLATFORM_PENALTY_ACCOUNT);
      const stayOf = database.prepare(`
        SELECT r.id, r.platform, r.finalPrice, c.firstName, c.lastName, p.name AS propertyName
        FROM reservations r JOIN clients c ON c.id = r.clientId JOIN properties p ON p.id = r.propertyId WHERE r.id = ?`);
      return penalties.listByDate({ from, before })
        .map((penalty) => buildPenaltyEntry(penalty, stayOf.get(penalty.reservationId), account))
        .filter(Boolean);
    },

    // Indemnités d'annulation encaissées dans le mois (specs/cancellation-compensation.md §3.3
    // rule 15): one entry per compensation whose `receivedDate` falls in the month. A `pending`
    // compensation is NOT accounting — no money moved yet, so it never reaches this list.
    // The account + VAT rate are read once here so `accountingExport` stays pure.
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
      const { account, vatRatePercent } = compensationSettings(settings.read());
      // An indemnity for a stay sold « Sans TVA » carries no VAT, whatever rate the plan names.
      const rateOf = (row) => (row.reservationId
        && vatRegimeModel.forRow(database, { id: row.reservationId }).regime === 'not_subject' ? 0 : vatRatePercent);
      return compensations.listReceivedByMonth({ from, nextMonth })
        .map((row) => buildCompensationEntry(row, { account, vatRatePercent: rateOf(row) }))
        .filter(Boolean);
    },

    // specs/resource-booking-pricing-and-invoicing.md rules 21-22 — the sales a plugin made outside any stay (the
    // nordic bath of a walk-in guest), on their payment day, for their part on the books: the caisse interne stays
    // off, exactly as a fiche's settlement (mixed-method-payments D2).
    standaloneSalesByMonth({ month, year }) {
      const mm = String(month).padStart(2, '0');
      const yyyy = String(year);
      const last = new Date(Date.UTC(Number(yyyy), Number(mm), 0)).getUTCDate();
      return sdk.coreModule('standaloneSales').list({ from: `${yyyy}-${mm}-01`, to: `${yyyy}-${mm}-${String(last).padStart(2, '0')}` })
        .filter((sale) => sale.booksCents > 0)
        .map(buildStandaloneEntry);
    },
  };
}

function buildStandaloneEntry(sale) {
  return {
    reservationId: null,
    kind: 'standalone',
    direction: 'standalone',
    standaloneKey: sale.key,
    standaloneLabel: sale.label,
    paidDate: sale.date,
    client: sale.client || { firstName: '', lastName: '' },
    encaissementTtc: Math.round(sale.booksCents) / 100,
    vatRatePercent: sale.vatRate === null || sale.vatRate === undefined ? null : Number(sale.vatRate),
    piece: sale.invoiceNumber || '',
  };
}

function hasTable(database, name) {
  try {
    return database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) != null;
  } catch {
    return false;
  }
}

// The compensation half of the export's settings (75880000 / 0 % unless the operator changed them).
function compensationSettings(accountSettings) {
  return {
    account: accountSettings.cancellationCompensationAccount,
    vatRatePercent: Number(accountSettings.vatRateCancellationCompensation) || 0,
  };
}

// One penalty → its own entry: debit the penalty account, credit the client's account, no VAT. The
// client account nets to the money the platform really paid; the balance entry is untouched.
function buildPenaltyEntry(penalty, stay, account) {
  if (!stay) return null;
  const ttc = round2(penalty.amount);
  if (!(ttc > 0)) return null;
  return {
    reservationId: stay.id,
    penaltyId: penalty.id,
    kind: 'penalty',
    direction: 'penalty',
    paidDate: penalty.date,
    client: { firstName: stay.firstName || '', lastName: stay.lastName || '' },
    propertyName: stay.propertyName || '',
    platform: stay.platform || '',
    finalPrice: round2(stay.finalPrice),
    encaissementTtc: ttc,
    encaissementNetTtc: ttc,
    commission: null,
    taxTtc: 0,
    fraction: 1,
    buckets: [],
    reason: penalty.reason,
    penaltyAccount: account,
    accountLabels: { [account]: 'Pénalité plateforme' },
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
// A `retained` avoir reverses encaissements line for line (one line per installment and bucket,
// specs/direct-installments.md rule 46), so it splits each line on its own, as each encaissement was
// split, and the accounts net to the cent. With one line per bucket, as every acompte avoir has, both
// splits are the same numbers.
// On a cancelled stay, the lines given back from the indemnity (bucket `indemnity`, specs/reservation-refunds.md
// rule 48) debit the indemnity account at its own rate — the mirror of the compensation entry — and never touch
// 706 or VAT on sales: that revenue was already reversed by the cancellation's `retained` avoir.
// A requalification line adjusted for earlier refunds keeps the TTC it was booked on as `unitPrice`
// (specs/payment-schedule-and-cancellation.md rule 55); every other avoir line carries its own amount there.
function isAdjustedLine(line) {
  return line.unitPrice != null && line.bucket !== 'touristTax' && round2(line.unitPrice) !== round2(line.amountTtc);
}

// Rule 55 — the HT / VAT of the earlier refunds, per `${bucket}|${rate}`, as their own entries booked them.
function earlierSplits(earlier) {
  const splits = new Map();
  for (const refund of earlier || []) {
    const entry = buildRefundEntry(refund);
    for (const line of refund.lines || []) {
      if (['touristTax', 'indemnity'].includes(line.bucket)) continue;
      const key = `${line.bucket}|${Number(line.vatRate || 0)}`;
      const current = splits.get(key) || { ttc: 0, vat: 0 };
      current.ttc = round2(current.ttc + Number(line.amountTtc || 0));
      splits.set(key, current);
    }
    for (const bucket of (entry && entry.buckets) || []) {
      const key = `${bucket.name}|${Number(bucket.ratePercent || 0)}`;
      if (splits.has(key)) splits.get(key).vat = round2(splits.get(key).vat + bucket.vat);
    }
  }
  return splits;
}

// Rule 55 — a requalification avoir adjusted for earlier refunds reverses what the books still hold on each bucket.
// Booked there: the acompte's lines (at their `unitPrice`) and the paid solde's share (`solde`); reversed already: the
// earlier refunds (`earlier`); left after the avoir: the sale money the register still offers on the bucket, which a
// refund of it reverses at its own split. So the avoir's VAT is booked − reversed − left, and 706 and 4457 net to the
// cent once that money goes back. A bucket that took a spill from another one splits each line on its own, as before.
function adjustedBucketSplit(name, rate, lines, earlier, solde, deposit) {
  if (!lines.some(isAdjustedLine)) return null;
  const reversed = earlier || { ttc: 0, vat: 0 };
  const sold = solde || { ttc: 0, vat: 0 };
  let bookedTtc = 0;
  let bookedVat = 0;
  let keptTtc = 0;
  for (const line of lines) {
    const booked = round2(isAdjustedLine(line) ? line.unitPrice : line.amountTtc);
    bookedTtc = round2(bookedTtc + booked);
    bookedVat = round2(bookedVat + bookedSplit(name, booked, rate, deposit).vat);
    keptTtc = round2(keptTtc + round2(line.amountTtc));
  }
  const leftTtc = round2(bookedTtc + sold.ttc - reversed.ttc - keptTtc);
  // Kept below what the acompte booked, the bucket took exactly its own refunds (nothing left); kept above, it took
  // the solde money that covered another bucket, and what is left is the rest of that solde money.
  if (keptTtc < bookedTtc ? leftTtc !== 0 : leftTtc < 0) return null;
  const vat = round2(bookedVat + sold.vat - reversed.vat - bucketFromTtc(name, leftTtc, rate).vat);
  if (vat < 0 || vat > keptTtc) return null;
  return { ht: round2(keptTtc - vat), vat };
}

// Rule 55 reading of 2026-11-02 (second review of PR #926) — the HT / VAT an acompte line of the avoir was booked on:
// the acompte entry's own HT for the bucket when the line is that bucket's share (within the residue cents the entry
// put on its VAT line), so the avoir reverses the HT the entry credited and the VAT it really booked; otherwise the
// line split at its rate.
function bookedSplit(name, ttc, rate, deposit) {
  if (deposit && Math.abs(round2(ttc - deposit.ttc)) <= CONTRIB_RESIDUE_TOLERANCE_TTC && ttc >= deposit.ht) {
    return { name, ht: deposit.ht, vat: round2(ttc - deposit.ht), ratePercent: Number(rate || 0) };
  }
  return bucketFromTtc(name, ttc, rate);
}

function buildRefundEntry(refund, { indemnity = null, earlier = null, solde = null, deposit = null } = {}) {
  const lines = refund.lines || [];
  const ttc = round2(refund.totalTtc);
  if (ttc <= 0) return null;

  const perLine = refund.method === 'retained';
  const byBucket = new Map(); // `${bucket}|${rate}` → { name, ttc, ht, vat, ratePercent }
  let taxTtc = 0;
  let indemnityTtc = 0;
  for (const line of lines) {
    const amount = round2(line.amountTtc);
    if (amount <= 0) continue;
    if (line.bucket === 'touristTax') { taxTtc = round2(taxTtc + amount); continue; }
    if (line.bucket === 'indemnity') { indemnityTtc = round2(indemnityTtc + amount); continue; }
    const rate = Number(line.vatRate || 0);
    const mapKey = `${line.bucket}|${rate}`;
    const current = byBucket.get(mapKey) || { name: line.bucket, ttc: 0, ht: 0, vat: 0, ratePercent: rate };
    current.ttc = round2(current.ttc + amount);
    const part = bucketFromTtc(line.bucket, amount, rate);
    current.ht = round2(current.ht + part.ht);
    current.vat = round2(current.vat + part.vat);
    byBucket.set(mapKey, current);
  }

  const splits = perLine && earlier ? earlierSplits(earlier) : null;
  const buckets = [...byBucket.values()]
    .map((b) => {
      if (!perLine) return bucketFromTtc(b.name, b.ttc, b.ratePercent);
      const key = `${b.name}|${b.ratePercent}`;
      const bucketLines = lines.filter((line) => line.bucket === b.name && Number(line.vatRate || 0) === b.ratePercent && round2(line.amountTtc) > 0);
      const depositSplit = deposit ? deposit.get(key) : null;
      const netted = splits ? adjustedBucketSplit(b.name, b.ratePercent, bucketLines, splits.get(key), solde && solde.get(key), depositSplit) : null;
      if (netted) return { name: b.name, ...netted, ratePercent: b.ratePercent };
      // One line per bucket, as every acompte avoir has: it mirrors the acompte entry.
      const mirrored = depositSplit && bucketLines.length === 1 && !isAdjustedLine(bucketLines[0])
        ? bookedSplit(b.name, b.ttc, b.ratePercent, depositSplit) : b;
      return { name: b.name, ht: mirrored.ht, vat: mirrored.vat, ratePercent: b.ratePercent };
    })
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
    ...(indemnityTtc > 0 ? { indemnity: indemnityShare(indemnityTtc, indemnity) } : {}),
    reason: refund.reason || '',
    method: refund.method,
  };
}

// Split cumulatively over the stay: this share's HT is HT(given back so far + it) − HT(given back so far), so once the
// whole indemnity is given back the shares' HT add up to the compensation's HT, at any rate (rule 48).
function indemnityShare(ttc, config) {
  const rate = Number(config && config.vatRatePercent) || 0;
  const prior = round2(Number(config && config.priorTtc) || 0);
  const htOf = (amount) => round2(amount / (1 + rate / 100));
  const ht = rate > 0 ? round2(htOf(prior + ttc) - htOf(prior)) : ttc;
  return { account: (config && config.account) || null, ht, vat: round2(ttc - ht), ratePercent: rate };
}

// One-shot snapshot of the per-platform commission config + the global default account. Computed once
// per export-run and threaded into every `buildEntry` call so we don't re-query the DB for every line;
// the sales VAT rate joins it per reservation (`withSalesVat`), each stay carrying its own regime.
function buildCommissionContext(accountSettings) {
  const defaultAccount = accountSettings.defaultCommissionAccountNumber || DEFAULT_COMMISSION_ACCOUNT;
  const vatRateCommission = Number(accountSettings.vatRateCommission);
  // Index platforms by lowercased name for case-insensitive matching (`Airbnb` vs `airbnb`).
  const platformsModel = sdk.coreModule('platformsModel');
  const platforms = (platformsModel.listAll ? platformsModel.listAll() : []) || [];
  const byName = new Map();
  for (const p of platforms) byName.set(String(p.name || '').toLowerCase(), p);
  return { defaultAccount, vatRateCommission, platformByName: byName };
}

// Resolve the commission config for one reservation. Returns null for direct bookings (no
// platform → no commission line). Returns `{ account, hasVat }` otherwise.
function resolveCommissionConfig(row, commissionContext) {
  if (!commissionContext) return null;
  const platform = String(row.platform || 'direct').toLowerCase();
  if (platform === 'direct') return null;
  const platformRow = commissionContext.platformByName.get(platform);
  const account = (platformRow && platformRow.commissionAccountNumber) || commissionContext.defaultAccount;
  // Under « Sans TVA » the platform's VAT on its commission is not deductible: it is a cost, booked TTC
  // on the commission account (vat-optional-mode rule 12g), whatever the platform row says.
  const deductible = commissionContext.salesRegime !== 'not_subject';
  const hasVat = platformRow ? Boolean(Number(platformRow.hasVatOnCommission)) && deductible : false;
  return { account, hasVat };
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
// One installment collected → one encaissement, booked like the solde it stands for: the stored-money
// split (a plan never captured per-line contribs), with the tourist tax shared out in proportion to the
// plan's scheduled total (the solde used to carry all of it). specs/direct-installments.md.
function buildInstallmentEntry(row, installment, count, taxShare, perLineData, commissionContext, taxContext) {
  const amount = round2(Number(installment.amountCents) / 100);
  const standIn = {
    ...row,
    depositAmount: 0,
    balanceAmount: amount,
    balancePaidDate: installment.paidDate,
    touristTaxTotal: taxShare,
    // specs/platform-added-guests-tourist-tax.md rule 27 — the share already leaves the addition out: never taken off twice.
    touristTaxAddedGuestsAmount: 0,
  };
  const entry = buildEntry(standIn, 'balance', { ...perLineData, hasContribs: false }, commissionContext, taxContext);
  if (!entry) return null;
  const frozen = parsePaidSplit(installment.paidSplit);
  if (!frozen) return { ...entry, kind: 'installment', installment: { number: installment.number, count } };
  // specs/accounting-books-the-money-collected.md rule 14 — collected, so frozen: the split stored at
  // payment time is booked verbatim, whatever the fiche became since (rule 33 of the export spec).
  const vatRate = commissionContext && Number.isFinite(Number(commissionContext.vatRate)) ? Number(commissionContext.vatRate) : 10;
  return {
    ...entry,
    kind: 'installment',
    installment: { number: installment.number, count },
    taxTtc: frozen.taxCents / 100,
    fraction: 1,
    buckets: [
      bucketFromTtc('accommodation', frozen.accommodationCents / 100, vatRate),
      bucketFromTtc('options',       frozen.optionsCents / 100,       vatRate),
      bucketFromTtc('resources',     frozen.resourcesCents / 100,     vatRate),
    ].filter((b) => b.ht > 0 || b.vat > 0),
  };
}

/**
 * specs/mixed-method-payments.md rule 26 — what the split payments of a stay paid, so the ordinary emission
 * leaves those buckets, notes and installments to their settlements.
 */
function splitTargetsOf(settlements) {
  const out = { buckets: new Set(), notes: new Set(), installments: new Set() };
  for (const s of settlements || []) {
    for (const p of s.parts || []) {
      if (p.kind === 'note') out.notes.add(String(p.key));
      else if (p.kind === 'installment') out.installments.add(String(p.key));
      else out.buckets.add(p.kind);
    }
  }
  return out;
}

// Rule 39 — each settlement's target, read at what it is worth now (`paymentTenders.targetFigures`).
function targetReader(settlements, row) {
  const byTarget = new Map();
  for (const s of settlements || []) {
    const key = `${s.targetKind}:${s.targetKey}`;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(s);
  }
  const figures = new Map();
  return (settlement) => {
    const key = `${settlement.targetKind}:${settlement.targetKey}`;
    if (!figures.has(key)) {
      const list = byTarget.get(key) || [settlement];
      figures.set(key, targetFigures(list, { currentCents: currentCentsOf(list[0].parts, row) }));
    }
    return figures.get(key);
  };
}

/**
 * What one settlement puts on the books (rules 18, 26, 39): its lines on the books and its booked geste, both
 * scaled by what still stands of them once the target's amount moved, and the share of the target's entries
 * that carries them. The entries are built at the target's current amount, so the share is taken over it: a
 * rise not yet collected books nothing, a fall books what is still owed of the money received.
 */
function bookedFigures(settlement, target) {
  const f = settlementFigures(settlement);
  const booksCents = f.booksCents * target.receivedFactor;
  const bookedWaivedCents = f.bookedWaivedCents * target.waivedFactor;
  const base = target.currentCents;
  return { booksCents, bookedWaivedCents, share: base > 0 ? (booksCents + bookedWaivedCents) / base : 0 };
}

// The share of a bucket the books carry, all its settlements together; 1 when it was not split.
function bookedShareOf(settlements, bucket, row) {
  const mine = (settlements || []).filter((s) => (s.parts || []).some((p) => p.kind === bucket));
  if (mine.length === 0) return 1;
  const targetOf = targetReader(settlements, row);
  return mine.reduce((sum, s) => sum + bookedFigures(s, targetOf(s)).share, 0);
}

// Rule 56 — what an entry left on the stay's sale accounts (credit − debit, in cents): the sale revenue (706, 706010,
// the activities, the rabais 709), the VAT collected and the tourist tax. An avoir's indemnity share is not a sale: its
// 7588 line is left out, and so is the VAT it debited on the shared VAT account.
const SALE_REVENUE_ACCOUNTS = new Set([...Object.values(BUCKET_TO_ACCOUNT), DISCOUNT_ACCOUNT]);
function addSaleLegs(legs, entry) {
  const add = (account, role, ratePercent, cents) => {
    const leg = legs.get(account) || { cents: 0, role, ratePercent };
    leg.cents += cents;
    legs.set(account, leg);
  };
  for (const line of entryVentilation(entry)) {
    const sale = (line.role === 'revenue' && SALE_REVENUE_ACCOUNTS.has(line.account)) || line.role === 'vat' || line.role === 'touristTax';
    if (sale) add(line.account, line.role, line.ratePercent, Math.round((line.credit - line.debit) * 100));
  }
  const indemnityVat = entry.indemnity ? Math.round(Number(entry.indemnity.vat || 0) * 100) : 0;
  if (indemnityVat > 0) add(vatAccountForRate(entry.indemnity.ratePercent), 'vat', Number(entry.indemnity.ratePercent) || 0, indemnityVat);
  return legs;
}

// One entry scaled to a settlement's share: the export prorates every credit by `fraction` and absorbs the
// rounding cent on the last one, so scaling the gross, the net, the tax and the fraction keeps it balanced.
function scaleEntry(entry, share, settlement) {
  const scaled = {
    ...entry,
    fraction: Number(entry.fraction == null ? 1 : entry.fraction) * share,
    encaissementTtc: round2(Number(entry.encaissementTtc || 0) * share),
    encaissementNetTtc: round2(Number(entry.encaissementNetTtc == null ? entry.encaissementTtc : entry.encaissementNetTtc) * share),
    taxTtc: round2(Number(entry.taxTtc || 0) * share),
    commission: entry.commission ? {
      ...entry.commission,
      ttc: round2(Number(entry.commission.ttc || 0) * share),
      ht: round2(Number(entry.commission.ht || 0) * share),
      vat: round2(Number(entry.commission.vat || 0) * share),
    } : entry.commission,
  };
  if (settlement) {
    scaled.paidDate = settlement.paidDate;
    scaled.settlementId = settlement.id;
  }
  return scaled;
}

// specs/mixed-method-payments.md rule 18 — the geste commercial of a settlement, booked like the single arrival
// payment's réduction accordée (rabais on 70900000 at the stay's rate), at the settlement's date.
function buildSettlementDiscountEntry(row, settlement, ttc, vatRate) {
  const rate = Number.isFinite(Number(vatRate)) ? Number(vatRate) : 10;
  const ht = round2(ttc / (1 + rate / 100));
  return {
    reservationId: row.id,
    kind: 'discount',
    direction: 'discount',
    paidDate: settlement.paidDate,
    settlementId: settlement.id,
    client: { firstName: row.firstName || '', lastName: row.lastName || '' },
    propertyName: row.propertyName || '',
    platform: row.platform || 'direct',
    finalPrice: round2(row.finalPrice),
    taxTtc: 0,
    commission: null,
    buckets: [],
    fraction: 1,
    encaissementTtc: round2(ttc),
    encaissementNetTtc: round2(ttc),
    discount: { account: DISCOUNT_ACCOUNT, ttc: round2(ttc), ht, vat: round2(ttc - ht), ratePercent: rate },
  };
}

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
    // 1 → stored amounts pass through UNSCALED. Prod bug 2026-07-15 (resa #22224, Berg): the old
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
    // of such a stay was grossed up by that amount (Marchand #22275: +29,42 € of CA, +25,47 € on the
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
  // specs/accounting-books-the-money-collected.md rule 16 — the split a collected complement was stamped with, read as long
  // as it adds up to the entry; the ratio's historical shapes and an operator's adjustment keep their own paths.
  const paidSplit = kind === 'complement' && !complementIsAdjusted && Math.abs(grossRatio - 1) < 1e-9 ? parseComplementPaidSplit(row, encaissementTtc) : null;
  const taxTtc = paidSplit
    ? paidSplit.tax
    : complementIsAdjusted && storedAllocation.tax != null
      ? round2(storedAllocation.tax)
      : computeTaxTtcForKind(row, kind, taxRoutedToComplement, encaissementTtc, soldeCaptureMatches(row, perLineData));
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

  if (paidSplit) {
    return {
      ...common,
      clientGrossAmount: round2(effectiveGross),
      fraction: 1,
      buckets: [
        bucketFromTtc('accommodation', paidSplit.accommodation, vatRate),
        bucketFromTtc('options',       paidSplit.options,       vatRate),
        bucketFromTtc('resources',     paidSplit.resources,     vatRate),
      ].filter((b) => b.ht > 0 || b.vat > 0),
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
  const ttcByBucket = hasContribs ? computeBucketTtcsFromContribs(row, perLineData, kind, taxRoutedToComplement) : null;
  // specs/accounting-books-the-money-collected.md rule 11 — contribs frozen at payment time that no
  // longer fit in the entry (the stay was reduced after it was paid: one guest fewer, breakfast cut)
  // would push the residue onto the last credit, the 46710000 tourist tax, as a negative line. Such an
  // entry is booked like one that never captured contribs: pro-rata of the lines as they stand now.
  // The same goes the other way (audit 2026-10-28): contribs captured when the échéance was smaller,
  // or a line that never captured one (a custom option added after the capture), leave a gap that the
  // export would absorb on the last credit, the VAT line (#13: +182,91 € of VAT; #22298: +17,66 €).
  // Contribs describe the entry only when they add up to it within the rounding tolerance.
  const contribsOverflow = Boolean(ttcByBucket)
    && Math.abs(round2(ttcByBucket.accommodation + ttcByBucket.options + ttcByBucket.resources + taxTtc)
      - round2(encaissementTtc)) > CONTRIB_RESIDUE_TOLERANCE_TTC;
  // specs/accounting-books-the-money-collected.md rule 12 — contribs only describe an entry whose CA is
  // the stored échéance (ratio 1, rule 10's premise). A historical shape grossed up to what the guest
  // paid (the `clientGrossAmount` era, réservation #13) captures its contribs from the stored NET solde
  // when it is ticked today: used as-is, the commission they leave out lands on the last credit, the
  // VAT line (Gîtes de France 706 € net / 907,20 € brut → 44571100 C265,38 on 641,82 of revenue). Such
  // an entry is booked on the stored-money path, which pro-rates the gross-up over its postes.
  const contribsDescribeEntry = Math.abs(grossRatio - 1) < 1e-9;
  if (hasContribs && !contribsOverflow && contribsDescribeEntry) {
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
  // The split lives in the core (utils/storedMoneySplit): the cancellation reverses a legacy acompte on the very
  // same postes (specs/payment-schedule-and-cancellation.md rule 55).
  const revenueTtc = Math.max(0, round2(encaissementTtc - taxTtc));
  const storedHere = storedMoneyCollected(kind, finalPriceTtc, perLineData);
  // specs/platform-extra-guest-complement.md rule 10, reading of 2026-11-05 (audit R22-5) — the added guests' supplement is
  // stay revenue from its first entry, whatever was paid before it.
  const collectedHere = kind === 'complement'
    ? { ...storedHere, accommodation: round2(nz(row.extraGuestComplementSurcharge)) }
    : storedHere;
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
    // The gross the guest paid, like the three paths above: a platform stay never loses it to a NULL column.
    // A direct stay has none to show.
    clientGrossAmount: platformIsNonDirect
      ? round2(effectiveGross)
      : (row.clientGrossAmount == null ? null : Number(row.clientGrossAmount)),
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
// is a resource (70601000), everything else a prestation (70600010). Marchand's bain nordique, sold
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
// Whether the solde's captured contribs describe the solde as stored: their sum is the encaissement by
// the capture's conservation invariant. A row whose stored solde no longer matches them (an older shape
// reduced after payment, accounting-books-the-money-collected rule 11) has no trustworthy frozen tax.
function soldeCaptureMatches(row, perLineData) {
  if (row.touristTaxSoldeContribTtc == null || row.accommodationSoldeContribTtc == null) return false;
  const lines = perLineData
    ? [...(perLineData.optionLines || []), ...(perLineData.customOptionLines || []), ...(perLineData.resourceLines || [])]
    : [];
  const captured = nz(row.accommodationSoldeContribTtc) + nz(row.touristTaxSoldeContribTtc)
    + lines.reduce((sum, l) => sum + nz(l.soldeContribTtc), 0);
  return Math.abs(round2(captured) - round2(nz(row.balanceAmount))) <= CONTRIB_RESIDUE_TOLERANCE_TTC;
}

function computeTaxTtcForKind(row, kind, taxRoutedToComplement, encaissementTtc, soldeFrozen = false) {
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
  // specs/platform-added-guests-tourist-tax.md rule 13 — the added guests' share is collected with the
  // complement; the solde books what the platform reversed.
  const added = round2(nz(row.touristTaxAddedGuestsAmount));
  if (kind === 'deposit') return 0;
  // specs/accounting-books-the-money-collected.md rule 13 — once the solde is paid, the tax it
  // collected is frozen in `touristTaxSoldeContribTtc` (plus the share an older acompte captured,
  // reclassed here). A tax that rises afterwards never rewrites that entry: the growth is collected —
  // and booked — by the arrival complement. A solde paid before contribs existed, or whose contribs no
  // longer describe it, keeps the live total.
  const frozenInSolde = soldeFrozen && Number(row.balancePaid || 0) === 1
    ? round2(nz(row.touristTaxAcompteContribTtc) + nz(row.touristTaxSoldeContribTtc))
    : null;
  if (kind === 'balance') {
    return round2(Math.min(frozenInSolde != null ? frozenInSolde : Math.max(0, total - added), cap));
  }
  if (kind === 'complement') {
    return round2(Math.min(frozenInSolde != null ? Math.max(0, total - frozenInSolde) : added, cap));
  }
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

// The split the core stamped on a collected complement (utils/complementPaidSplit.js), in euros; null when absent,
// unreadable, or no longer adding up to the entry. Parsed here so the export asks nothing new of an older core.
function parseComplementPaidSplit(row, encaissementTtc) {
  if (!row.complementPaidSplit) return null;
  let split;
  try { split = JSON.parse(row.complementPaidSplit); } catch { return null; }
  const keys = ['taxCents', 'accommodationCents', 'optionsCents', 'resourcesCents'];
  if (!split || !keys.every((k) => Number.isInteger(split[k]))) return null;
  if (keys.reduce((sum, k) => sum + split[k], 0) !== Math.round(Number(encaissementTtc) * 100)) return null;
  return {
    tax: split.taxCents / 100,
    accommodation: split.accommodationCents / 100,
    options: split.optionsCents / 100,
    resources: split.resourcesCents / 100,
  };
}

// The `paidSplit` JSON the core stores on a collected installment (utils/installmentPaidSplit.js);
// anything unreadable reads as « no frozen split ».
function parsePaidSplit(raw) {
  if (!raw) return null;
  try {
    const split = JSON.parse(raw);
    const keys = ['taxCents', 'accommodationCents', 'optionsCents', 'resourcesCents'];
    return split && keys.every((k) => Number.isInteger(split[k])) ? split : null;
  } catch {
    return null;
  }
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

module.exports = {
  buildStandaloneEntry,
  create: createAccountingModel,
  __test: { buildEntry, buildEndOfStayEntry, splitByDestination, buildInstallmentEntry, buildRefundEntry },
};
