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
const accountPlan = require('./accountPlan');
const { createAccountSettings, readTtcSplitFrom, readStayClosingFrom } = require('./settings');
const { csvJournal } = require('./accountingExport');

const { isPlatformCollectingTouristTax } = sdk.coreModule('pricing');
const vatRegimeModel = sdk.coreModule('vatRegimeModel');
const { buildPerLineData, splitByDestination } = sdk.coreModule('storedMoneySplit');
const { createModel: createRefundsModel } = sdk.coreModule('refundsModel');
const { buildModel: buildCompensationsModel } = sdk.coreModule('cancellationCompensationsModel');
const { buildModel: buildPenaltiesModel } = sdk.coreModule('platformPenaltiesModel');
const { buildModel: buildSettlementsModel } = sdk.coreModule('paymentSettlementsModel');
const { bookedBucketSplit, round2 } = sdk.coreModule('legacyBucketSplit');
const {
  create: createAccountingOutput, buildStandaloneEntry, buildPenaltyEntry, buildCompensationEntry,
} = sdk.coreModule('accountingOutput');
const {
  buildRefundEntry, isAdjustedLine, closeStayBooks: closeBooksOf,
} = sdk.coreModule('refundJournal');

// The entry builders and the sale entries are the core's `AccountingOutput`; this model reads the stored data they need.
const {
  buildEntry, buildInstallmentEntry, buildEndOfStayEntry, bookedShareOf, scaleEntry, addSaleLegs, saleEntries,
} = createAccountingOutput({ accountPlan });
const { DEFAULT_COMMISSION_ACCOUNT, PLATFORM_PENALTY_ACCOUNT } = accountPlan;

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
  const platformGrossCol = hasReservationColumn('platformGrossAmount')
    ? 'r.platformGrossAmount'
    : 'NULL AS platformGrossAmount';
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
      return saleEntries({ from, nextMonth }, {
        reservations: () => database.prepare(`
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
                 ${addedGuestsTaxCol}, ${surchargeCol}, ${platformGrossCol}, ${bookedEntryCols},
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
          : [from, nextMonth, from, nextMonth, from, nextMonth, from, nextMonth, ...(hasInstallments ? [from, nextMonth] : []), ...midStayNotesParams(from), ...(hasSettlements ? [from, nextMonth] : [])])),
        commissionContext: () => buildCommissionContext(settings.read()),
        tipAccount: () => settings.read().tipAccount,
        regimeOf: (row) => vatRegimeModel.forRow(database, row),
        perLineData: (row) => buildPerLineData(database, row),
        taxContextOf,
        settlementsOf: (id) => settlementsStore.listFor(id),
        installmentsOf: (id) => (hasInstallments
          ? database.prepare(`SELECT id, number, amountCents, paidDate, paid, ${paidSplitCol} FROM reservation_installments WHERE reservationId = ? ORDER BY number`).all(id)
          : []),
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
    const closeStayBooks = (entry, row) => closeBooksOf(entry, row, { entriesOfStay, earlierRefundsOf, entryOf, addSaleLegs });
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

module.exports = {
  buildStandaloneEntry,
  create: createAccountingModel,
  __test: { buildEntry, buildEndOfStayEntry, splitByDestination, buildInstallmentEntry, buildRefundEntry },
};
