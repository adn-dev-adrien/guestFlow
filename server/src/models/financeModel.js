// Finance model — all finance DB access + shaping. Returns ready-to-render payloads so the client
// renders only. Payment figures come from the shared computePaymentStatus authority.

const db = require('../database');
const { calculateReservationQuote } = require('../utils/pricing');
const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const { computePaymentStatus, round2 } = require('../utils/paymentStatus');
const { getMonthBounds } = require('../utils/financeCalcs');
const {
  isSettled, remainingToPay, platformCommission, midStayNotesTotal, refundsBook, comptaCollected,
} = require('../utils/reservationSettlement');
const fiscalYearUtil = require('../utils/fiscalYear');

const UPCOMING_PER_PROPERTY = 5;

// specs/fiscal-year-and-nights-sold.md §3.2 — SQL twin of reservationSettlement's `attributionDate`:
// the date a stay is attached to for accounting = when its SOLDE was collected, falling back to the
// departure date when it never was (unpaid stay, or no solde at all). Every money window of this file
// filters and sorts on it instead of `r.endDate`, because the books are kept on a cash basis.
// `DATE(...)` normalises a legacy 'YYYY-MM-DD HH:MM:SS' value to a plain day.
// Pinned against the JS helper by tests/finance-attribution-date.unit.test.js.
//
// Guarded at factory level like the refund columns below: a minimal test schema without
// `balancePaidDate` degrades to the plain departure date rather than failing every query.
const ATTRIBUTION_DATE_SQL_FULL = `(
  CASE
    WHEN r.balancePaid = 1 AND TRIM(COALESCE(r.balancePaidDate, '')) <> ''
      THEN DATE(r.balancePaidDate)
    ELSE r.endDate
  END
)`;

// specs/tourist-tax-on-solde.md — SQL predicate: is a reservation's tourist tax COLLECTED ON ARRIVAL
// (→ it rides on the complement, paid at check-in) rather than on the solde? True when the operator
// forced it to the complement (`touristTaxInComplement = 1`) OR the GLOBAL platform mode is « we collect
// at arrival » (`collectsTouristTax = 0` on a non-direct platform — matches the engine's
// `isTouristTaxCollectedOnArrival = !collectsFromGuest && platform != 'direct'`). Else the tax is on the
// solde. Referenced inside the getTouristTaxExtraction query (aliased `r` for the reservations table).
const TAX_ON_ARRIVAL_SQL = `(
  r.touristTaxInComplement = 1
  OR EXISTS (
    SELECT 1 FROM platforms pl
    WHERE lower(pl.name) = lower(r.platform) AND pl.collectsTouristTax = 0
  )
  OR EXISTS (
    SELECT 1 FROM ical_sources s JOIN platforms pl ON lower(pl.name) = lower(s.platformLabel)
    WHERE (lower(s.platformKey) = lower(r.platform) OR lower(s.platformLabel) = lower(r.platform))
      AND pl.collectsTouristTax = 0
  )
)`;

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function nightsBetween(startDate, endDate) {
  const ms = new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.round(ms / 86400000));
}

// specs/finance-overview-rework.md §3.1 + specs/fiche-total-sejour-net-of-commission.md — the « total de
// séjour » shown in the Suivi financier is the « total perçu sur le séjour » = what the operator actually
// earns = acompte + solde + complément d'arrivée + complément de fin de séjour, NET of the platform
// commission, with BOTH complements EXCLUDED when settled via caisse interne (off-books). Direct →
// commission 0 → unchanged.
function totalSejour(r) {
  const deposit = Number(r.depositAmount || 0);
  const balance = Number(r.balanceAmount || 0);
  const complement = r.complementPaidCash ? 0 : Number(r.complementAmount || 0);
  const endOfStay = r.endOfStayComplementPaidCash ? 0 : Number(r.endOfStayComplementAmount || 0);
  return round2(deposit + balance + complement + endOfStay + midStayNotesTotal(r)
    - platformCommission(r) - refundsBook(r));
}

// `isSettled` (specs/finance-overview-rework.md §3.3), `remainingToPay`
// (specs/finance-operational-remaining-to-pay.md §3) and `comptaCollected` (« encaissé ») live in
// utils/reservationSettlement.js — the day-of-operations collection status and the refund dialog
// share the very same bucket rules (specs/dashboard-collection-alert.md).

function getVatRate(database) {
  const row = database.prepare('SELECT vatRate FROM app_settings WHERE id = 1').get();
  return row && row.vatRate != null ? Number(row.vatRate) : 10;
}

// Accounting closing month (specs/fiscal-year-and-nights-sold.md §3.1). A minimal test schema without
// the column — or a fresh install — degrades to 12 = calendar year, the pre-spec behaviour.
function getFiscalYearEndMonth(database) {
  try {
    const row = database.prepare('SELECT fiscalYearEndMonth FROM app_settings WHERE id = 1').get();
    return fiscalYearUtil.normaliseEndMonth(row && row.fiscalYearEndMonth);
  } catch {
    return fiscalYearUtil.DEFAULT_END_MONTH;
  }
}

// specs/finance-overview-rework.md §3.7 — element-by-element HT (decision 2026-06-16): the VAT-able revenue
// of a reservation is `finalPrice` (accommodation + options + resources, single global rate); the tourist
// tax bears NO VAT and is NOT revenue HT. The HT fraction of the full TTC is therefore
// (finalPrice ÷ (1+vat)) ÷ (finalPrice + touristTax). We apply that fraction to whatever TTC portion we're
// summing (total de séjour, encaissé, …) so the HT stays consistent with the TTC figure shown above it.
function htAmount(r, ttcPortion, vatRate) {
  const portion = Number(ttcPortion || 0);
  if (portion <= 0) return 0;
  const finalPrice = Math.max(0, Number(r.finalPrice || 0));
  const tax = Math.max(0, Number(r.touristTaxTotal || 0));
  const fullTtc = finalPrice + tax;
  if (fullTtc <= 0) return 0;
  const ratio = (finalPrice / (1 + vatRate / 100)) / fullTtc;
  return round2(portion * ratio);
}

// specs/finance-card-breakdown.md §3.5 — the five clickable cards, each mapped to the reservation window
// it sums over and the label its amount column carries in the breakdown dialog. The `total` of a
// breakdown is guaranteed equal to the matching getSummary figure because both reuse totalSejour /
// comptaCollected / isSettled over the same set.
// specs/fiscal-year-and-nights-sold.md §3.4 rules 18-19 + 22 — `nights: true` marks the three metrics
// whose amount is Σ « total de séjour » over a SET OF STAYS: they carry the per-property nights on
// their card and a « Nuits » column in the breakdown. « Encaissé » and « En attente » are subsets of
// échéances, not sets of stays, so a nights figure there would be ambiguous.
const BREAKDOWN_METRICS = {
  revenueTotal:   { label: 'Revenu total sur la période',            column: 'Total de séjour', window: 'period',     nights: true },
  totalCollected: { label: 'Encaissé',                               column: 'Encaissé',        window: 'period' },
  totalPending:   { label: 'En attente de règlement',                column: 'En attente',      window: 'global' },
  yearToDate:     { label: "Revenus depuis le début de l'exercice",  column: 'Total de séjour', window: 'fiscalYear', nights: true },
  yearTotal:      { label: "Revenu total sur l'exercice",            column: 'Total de séjour', window: 'fiscalYear', nights: true },
};

function createFinanceModel(database) {
  const hasReservationColumn = (name) => {
    try { return database.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === name); }
    catch { return false; }
  };
  // The window key of every money query (see ATTRIBUTION_DATE_SQL_FULL above).
  const ATTRIBUTION_DATE_SQL = hasReservationColumn('balancePaidDate')
    ? ATTRIBUTION_DATE_SQL_FULL
    : 'r.endDate';

  // specs/reservation-refunds.md §3.3 — per-reservation refund totals, injected into every query that
  // feeds totalSejour/comptaCollected. Guarded like the mid-stay columns: a minimal test schema without
  // the refund tables degrades to 0 (no refund) instead of failing the query.
  const hasRefundTables = (() => {
    try {
      return database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reservation_refunds'").get() != null;
    } catch { return false; }
  })();
  const REFUND_COLS = hasRefundTables
    ? `COALESCE((SELECT SUM(rf.totalTtc) FROM reservation_refunds rf
                 WHERE rf.reservationId = r.id AND rf.method <> 'internal'), 0) AS refundsBookTtc,
       COALESCE((SELECT SUM(rf.totalTtc) FROM reservation_refunds rf
                 WHERE rf.reservationId = r.id), 0) AS refundsWithCashTtc`
    : '0 AS refundsBookTtc, 0 AS refundsWithCashTtc';
  // specs/reservation-refunds.md §3.5 — the tourist tax given back to the guest, in euros and in
  // nights. EVERY means counts here (caisse interne included): « hors comptabilité » excludes money
  // from the turnover, never from what is owed to the commune.
  const REFUNDED_TAX_COLS = hasRefundTables
    ? `COALESCE((SELECT SUM(rl.amountTtc) FROM reservation_refund_lines rl
                 JOIN reservation_refunds rf ON rf.id = rl.refundId
                 WHERE rf.reservationId = r.id AND rl.lineKey = 'touristTax'), 0) AS refundedTaxAmount,
       COALESCE((SELECT SUM(COALESCE(rl.quantity, 0)) FROM reservation_refund_lines rl
                 JOIN reservation_refunds rf ON rf.id = rl.refundId
                 WHERE rf.reservationId = r.id AND rl.lineKey = 'touristTax'), 0) AS refundedTaxNights`
    : '0 AS refundedTaxAmount, 0 AS refundedTaxNights';

  const model = {
    // Financial summary for a date range; each reservation carries its payment status.
    //
    // All amounts are driven by the **encaissement** schedule (depositAmount + balanceAmount +
    // complementAmount), NEVER `finalPrice`. Rationale: `finalPrice` excludes the tourist tax
    // and the 3rd-bucket complement, so summing it produces `totalRevenue ≠ totalCollected +
    // totalPending` and the cards lose coherence. The encaissement amounts capture what the
    // customer actually owes (tax included where applicable) and add up by construction.
    //
    // `revenueByProperty` (added 2026-06-02) aggregates per logement so the FinancePage's
    // overview chart can render "revenu par logement" instead of "revenu par réservation"
    // (which was unreadable when many reservations stacked up).
    // specs/finance-per-property-revenue-chart.md — `revenueByProperty` (period) and
    // `yearToDateByProperty` (Jan 1 → today) are the two windows of that chart's tabs: both carry a
    // `revenueHt`, are seeded from the properties table (a logement with no reservation appears at
    // 0), and are sorted revenue desc with ties broken by name.
    // specs/finance-overview-rework.md §3.2 — every revenue figure is Σ « total de séjour », a reservation
    // counted by its DEPARTURE date (endDate). The period uses the du/au range; two extra figures cover
    // the calendar year (to-date + full). « Encaissé » = the accounting total (comptaCollected).
    // specs/finance-pending-global-remaining.md — « En attente de règlement » is GLOBAL (every finished
    // stay, period ignored) and counts the RESTANT DÛ (Σ remainingToPay), so it equals the operational
    // « Paiements en attente » chip and never double-counts what « Encaissé » already holds.
    getSummary({ from, to, fiscalYear } = {}) {
      const today = todayIso();
      const start = from || today;
      const end = to || '2099-12-31';

      // Selected exercise + the selector's options (specs/fiscal-year-and-nights-sold.md §3.5).
      const endMonth = getFiscalYearEndMonth(database);
      const exercise = fiscalYearUtil.resolve(endMonth, { key: fiscalYear, today });
      const currentExercise = fiscalYearUtil.containing(endMonth, today);
      const attributionRange = database.prepare(`
        SELECT MIN(${ATTRIBUTION_DATE_SQL}) AS minDate, MAX(${ATTRIBUTION_DATE_SQL}) AS maxDate
        FROM reservations r WHERE r.kind = 'reservation'
      `).get() || {};
      const fiscalYears = fiscalYearUtil.list(endMonth, {
        minDate: attributionRange.minDate,
        maxDate: attributionRange.maxDate,
        today,
      });

      const reservations = database.prepare(`
        SELECT r.*, c.lastName, c.firstName, c.email, p.name as propertyName,
               ${ATTRIBUTION_DATE_SQL} AS attributionDate,
               ${REFUND_COLS}
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation'
          AND ${ATTRIBUTION_DATE_SQL} >= ? AND ${ATTRIBUTION_DATE_SQL} <= ?
        ORDER BY ${ATTRIBUTION_DATE_SQL}
      `).all(start, end);

      const vatRate = getVatRate(database);
      let revenueTotal = 0;
      let totalCollected = 0;
      let revenueTotalHt = 0;
      let totalCollectedHt = 0;
      // The three per-logement aggregates are seeded from the properties table so every logement is in
      // the payload, 0 included (specs/finance-per-property-revenue-chart.md rule 6). Each one now also
      // carries the NIGHTS SOLD over its window (specs/fiscal-year-and-nights-sold.md §3.3).
      const emptyAgg = (p) => ({ propertyId: p.id, propertyName: p.name, revenue: 0, revenueHt: 0, nights: 0 });
      const allProperties = database.prepare('SELECT id, name FROM properties').all();
      const byProperty = new Map(allProperties.map((p) => [p.id, emptyAgg(p)]));
      const yearByProperty = new Map(allProperties.map((p) => [p.id, emptyAgg(p)]));
      const yearTotalByProperty = new Map(allProperties.map((p) => [p.id, emptyAgg(p)]));
      const finalizeByProperty = (map) => Array.from(map.values())
        .map((p) => ({
          propertyId: p.propertyId,
          propertyName: p.propertyName,
          revenue: round2(p.revenue),
          revenueHt: round2(p.revenueHt),
          nights: p.nights,
        }))
        .sort((a, b) => (b.revenue - a.revenue) || a.propertyName.localeCompare(b.propertyName, 'fr'));
      // A reservation absent from the seed (its logement was deleted) still contributes, under its own
      // name, rather than vanishing from the aggregate.
      const accumulate = (map, r, stay, stayHt, nights) => {
        const agg = map.get(r.propertyId)
          || { propertyId: r.propertyId, propertyName: r.propertyName, revenue: 0, revenueHt: 0, nights: 0 };
        agg.revenue += stay;
        agg.revenueHt += stayHt;
        agg.nights += nights;
        map.set(r.propertyId, agg);
      };

      let revenueTotalNights = 0;
      const enriched = reservations.map((r) => {
        const stay = totalSejour(r);
        const stayHt = htAmount(r, stay, vatRate);
        const settled = isSettled(r);
        const collected = comptaCollected(r);
        const nights = nightsBetween(r.startDate, r.endDate);
        revenueTotal += stay;
        revenueTotalHt += stayHt;
        revenueTotalNights += nights;
        totalCollected += collected;
        totalCollectedHt += htAmount(r, collected, vatRate);

        accumulate(byProperty, r, stay, stayHt, nights);

        const status = computePaymentStatus(r, today);
        return {
          ...r,
          totalSejour: stay,
          nights,
          settled,
          remainingDue: status.remainingDue,
          paymentComplete: status.paymentComplete,
        };
      });

      const revenueByProperty = finalizeByProperty(byProperty);

      // « En attente de règlement » — GLOBAL, period ignored (specs/finance-pending-global-remaining.md):
      // every finished stay (endDate < today) not yet settled, counted for its RESTANT DÛ only
      // (Σ remainingToPay, net of the unpaid échéances' commissions). Same predicate + amount as
      // getOperational().pending, so the card always equals the operational tab's chip.
      let totalPending = 0;
      let totalPendingHt = 0;
      const pastRows = database.prepare(`
        SELECT * FROM reservations WHERE kind = 'reservation' AND endDate < ?
      `).all(today);
      for (const r of pastRows) {
        if (isSettled(r)) continue;
        const remaining = remainingToPay(r);
        totalPending += remaining;
        totalPendingHt += htAmount(r, remaining, vatRate);
      }

      // Exercise cards — the SELECTED fiscal year, independent of the du/au period. Attributed by the
      // accounting date, so a stay settled before the closing counts in the closing exercise even when
      // the guest leaves after it (specs/fiscal-year-and-nights-sold.md §3.2).
      const yearRows = database.prepare(`
        SELECT depositAmount, balanceAmount, complementAmount, complementPaidCash,
               endOfStayComplementAmount, endOfStayComplementPaidCash, midStaySettledNotes,
               r.startDate, r.endDate,
               ${ATTRIBUTION_DATE_SQL} AS attributionDate,
               finalPrice, touristTaxTotal, platformCommissionAmount, acompteCommissionAmount,
               r.propertyId, p.name AS propertyName,
               ${REFUND_COLS}
        FROM reservations r JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation'
          AND ${ATTRIBUTION_DATE_SQL} >= ? AND ${ATTRIBUTION_DATE_SQL} <= ?
      `).all(exercise.from, exercise.to);
      let yearToDate = 0;
      let yearTotal = 0;
      let yearToDateHt = 0;
      let yearTotalHt = 0;
      let yearToDateNights = 0;
      let yearTotalNights = 0;
      for (const r of yearRows) {
        const stay = totalSejour(r);
        const stayHt = htAmount(r, stay, vatRate);
        const nights = nightsBetween(r.startDate, r.endDate);
        yearTotal += stay;
        yearTotalHt += stayHt;
        yearTotalNights += nights;
        accumulate(yearTotalByProperty, r, stay, stayHt, nights);
        // « Depuis le début de l'exercice » stops at today — on a closed exercise that is the whole
        // exercise (rule 16), on a future one it is empty (rule 17).
        if (r.attributionDate <= today) {
          yearToDate += stay;
          yearToDateHt += stayHt;
          yearToDateNights += nights;
          accumulate(yearByProperty, r, stay, stayHt, nights);
        }
      }
      const yearToDateByProperty = finalizeByProperty(yearByProperty);
      const yearTotalByPropertyList = finalizeByProperty(yearTotalByProperty);

      return {
        revenueTotal:   round2(revenueTotal),   // Σ total-séjour over the period (by attribution date)
        revenueTotalHt: round2(revenueTotalHt), // …its element-by-element HT (tax excluded, ÷ vat)
        revenueTotalNights,                     // …and the nights sold over that same set
        totalCollected: round2(totalCollected), // accounting total (encaissé)
        totalCollectedHt: round2(totalCollectedHt),
        totalPending:   round2(totalPending),   // Σ remainingToPay of ALL past + non-settled (global)
        totalPendingHt: round2(totalPendingHt),
        yearToDate:     round2(yearToDate),      // Σ total-séjour, exercise start → today
        yearToDateHt:   round2(yearToDateHt),
        yearToDateNights,
        yearTotal:      round2(yearTotal),       // Σ total-séjour, whole selected exercise
        yearTotalHt:    round2(yearTotalHt),
        yearTotalNights,
        reservations:   enriched,
        revenueByProperty,      // period, per logement (+ revenueHt + nights, zero-seeded)
        yearToDateByProperty,   // exercise start → today, per logement (same shape)
        yearTotalByProperty: yearTotalByPropertyList, // whole exercise, per logement (same shape)
        // The exercise the annual figures describe + the selector's options (§3.5).
        fiscalYear: { ...exercise, isCurrent: Boolean(currentExercise && currentExercise.key === exercise.key) },
        fiscalYears,
      };
    },

    // specs/finance-card-breakdown.md — the reservations behind a single card figure, with one amount
    // column whose Σ equals the card. Reuses the SAME per-reservation helpers as getSummary so the total
    // is coherent by construction. Period metrics honour the du/au range; the exercise metrics use the
    // selected fiscal year (the from/to are ignored for them).
    getBreakdown({ metric, from, to, fiscalYear } = {}) {
      const def = BREAKDOWN_METRICS[metric];
      if (!def) return { ok: false, status: 400, error: 'Métrique inconnue.' };

      const today = todayIso();
      const vatRate = getVatRate(database);

      // Same attribution window as getSummary (specs/fiscal-year-and-nights-sold.md §3.2 rule 8), so a
      // breakdown always lists exactly the stays that built the card figure.
      const selectRows = (start, end) => database.prepare(`
        SELECT r.*, c.lastName, c.firstName, p.name as propertyName,
               ${ATTRIBUTION_DATE_SQL} AS attributionDate,
               ${REFUND_COLS}
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation'
          AND ${ATTRIBUTION_DATE_SQL} >= ? AND ${ATTRIBUTION_DATE_SQL} <= ?
        ORDER BY ${ATTRIBUTION_DATE_SQL}
      `).all(start, end);

      let rows;
      let windowMeta;
      if (def.window === 'global') {
        // specs/finance-pending-global-remaining.md — « En attente de règlement » ignores the du/au
        // range entirely: every finished stay up to yesterday. The received from/to are unused here.
        rows = selectRows('0000-01-01', today);
        windowMeta = { kind: 'global', to: today };
      } else if (def.window === 'period') {
        const start = from || today;
        const end = to || '2099-12-31';
        rows = selectRows(start, end);
        windowMeta = { kind: 'period', from: start, to: end };
      } else {
        const exercise = fiscalYearUtil.resolve(getFiscalYearEndMonth(database), { key: fiscalYear, today });
        rows = selectRows(exercise.from, exercise.to);
        windowMeta = { kind: 'fiscalYear', key: exercise.key, label: exercise.label, from: exercise.from, to: exercise.to };
      }

      // include = does this reservation contribute to the figure; amount = its contribution. Mirrors the
      // exact predicates getSummary applies for each figure (a non-contributing row would just add 0).
      const contribution = (r) => {
        switch (metric) {
          case 'totalCollected': { const amount = comptaCollected(r); return { include: amount > 0, amount }; }
          // Restant dû of every finished, non-settled stay (period-free — spec above). A non-settled
          // stay's attribution date IS its departure date, so this stays the « séjour terminé » predicate.
          case 'totalPending':   return { include: r.endDate < today && !isSettled(r), amount: remainingToPay(r) };
          case 'yearToDate':     return { include: r.attributionDate <= today, amount: totalSejour(r) };
          case 'revenueTotal':
          case 'yearTotal':
          default:               return { include: true, amount: totalSejour(r) };
        }
      };

      let total = 0;
      let totalHt = 0;
      let totalNights = 0;
      const outRows = [];
      for (const r of rows) {
        const { include, amount } = contribution(r);
        if (!include) continue;
        const amountHt = htAmount(r, amount, vatRate);
        const nights = nightsBetween(r.startDate, r.endDate);
        total += amount;
        totalHt += amountHt;
        totalNights += nights;
        outRows.push({
          id: r.id,
          clientName: `${r.firstName} ${r.lastName}`.trim(),
          propertyName: r.propertyName,
          platform: r.platform,
          startDate: r.startDate,
          endDate: r.endDate,
          amount: round2(amount),
          amountHt,
          // Only the set-of-stays metrics expose nights (rule 19); elsewhere the key is absent and the
          // client renders no column.
          ...(def.nights ? { nights } : {}),
        });
      }

      return {
        ok: true,
        data: {
          metric,
          label: def.label,
          column: def.column,
          window: windowMeta,
          total: round2(total),
          totalHt: round2(totalHt),
          ...(def.nights ? { totalNights } : {}),
          rows: outRows,
        },
      };
    },

    // Projection by a target date (specs/finance-overview-rework.md §3.4): the revenue realised by that
    // date = Σ total-de-séjour of reservations attributed on/before it, split into the accounting
    // « encaissé » and the rest still « en attente ». Attribution = solde payment date, else departure
    // (specs/fiscal-year-and-nights-sold.md §3.2 rule 8).
    getProjection({ date } = {}) {
      const targetDate = date || todayIso();

      const reservations = database.prepare(`
        SELECT r.*, c.lastName, c.firstName, c.email, p.name as propertyName,
               ${ATTRIBUTION_DATE_SQL} AS attributionDate,
               ${REFUND_COLS}
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation' AND ${ATTRIBUTION_DATE_SQL} <= ?
        ORDER BY ${ATTRIBUTION_DATE_SQL}
      `).all(targetDate);

      let total = 0;
      let collected = 0;
      const details = [];

      for (const r of reservations) {
        const stay = totalSejour(r);
        const comp = comptaCollected(r);
        total += stay;
        collected += comp;
        details.push({
          reservationId: r.id,
          clientName: `${r.firstName} ${r.lastName}`,
          propertyName: r.propertyName,
          startDate: r.startDate,
          endDate: r.endDate,
          totalSejour: stay,
          collected: comp,
          settled: isSettled(r),
        });
      }

      return {
        targetDate,
        total: round2(total),                       // Σ total-séjour by the target date
        collected: round2(collected),               // accounting total among them
        pending: round2(total - collected),         // the rest
        details,
      };
    },

    // The whole "Suivi opérationnel" section, fully shaped: overdue (sorted + aggregates),
    // pending list, and the flat upcoming list (top-N per property).
    getOperational() {
      const today = todayIso();

      const allRows = database.prepare(`
        SELECT r.*, c.lastName, c.firstName, c.email, c.phone, p.name as propertyName,
               ${REFUND_COLS}
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation'
        ORDER BY r.startDate
      `).all();

      const enrich = (r) => ({
        ...r,
        ...computePaymentStatus(r, today),
        totalSejour: totalSejour(r),
        // Real outstanding amount = Σ still-owed buckets (deposit + balance + both complements),
        // each counted only when not yet settled (specs/finance-operational-remaining-to-pay.md §3).
        remainingToPay: remainingToPay(r),
        settled: isSettled(r),
        nights: nightsBetween(r.startDate, r.endDate),
      });

      // Overdue: DIRECT bookings only — platforms collect the guest's payment themselves, so a late
      // platform reservation isn't the operator's dunning concern (specs/finance-overview-rework.md §3.6).
      const overdueReservations = allRows.map(enrich)
        .filter((r) => String(r.platform || 'direct').toLowerCase() === 'direct' && r.isOverdue && !r.settled)
        .sort((a, b) => (a.oldestDueDate || '').localeCompare(b.oldestDueDate || ''));
      const overdueTotalAmount = round2(
        overdueReservations.reduce((sum, r) => sum + Number(r.overdueAmount || 0), 0),
      );

      // Pending = PAST stays (endDate < today) not yet settled. The amount shown is the total de séjour;
      // a caisse-interne complement counts as settled so it drops out (§3.3 / §3.6).
      const pending = allRows.map(enrich)
        .filter((r) => r.endDate < today && !r.settled)
        .sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''));

      // Upcoming = endDate >= today, top-N per property by start date, flattened + sorted.
      const byProperty = new Map();
      for (const r of allRows) {
        if (r.endDate < today) continue;
        const list = byProperty.get(r.propertyId) || [];
        if (list.length < UPCOMING_PER_PROPERTY) {
          list.push(enrich(r));
          byProperty.set(r.propertyId, list);
        }
      }
      const upcoming = Array.from(byProperty.values())
        .flat()
        .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

      // Column totals for each table footer (specs/finance-overview-rework.md §3.6). Sums match the
      // displayed columns: a disabled deposit shows « Désactivé » (no amount) so it doesn't count.
      const sumBy = (rows, key, predicate) => round2(
        rows.reduce((s, r) => s + ((!predicate || predicate(r)) ? Number(r[key] || 0) : 0), 0),
      );
      const notDisabledDeposit = (r) => !r.depositDisabled;

      return {
        overdue: {
          reservations: overdueReservations,
          count: overdueReservations.length,
          totalAmount: overdueTotalAmount,
          totals: { overdueAmount: overdueTotalAmount },
        },
        pending: {
          reservations: pending,
          totals: {
            depositAmount: sumBy(pending, 'depositAmount', notDisabledDeposit),
            balanceAmount: sumBy(pending, 'balanceAmount'),
            complementAmount: sumBy(pending, 'complementAmount'),
            endOfStayComplementAmount: sumBy(pending, 'endOfStayComplementAmount'),
            // Real outstanding (§3 rule 4) — Σ remainingToPay; replaces the deposit+balance-only remainingDue.
            remainingToPay: sumBy(pending, 'remainingToPay'),
            remainingDue: sumBy(pending, 'remainingDue'),
            totalSejour: sumBy(pending, 'totalSejour'),
          },
        },
        upcoming: {
          reservations: upcoming,
          totals: {
            depositAmount: sumBy(upcoming, 'depositAmount', notDisabledDeposit),
            balanceAmount: sumBy(upcoming, 'balanceAmount'),
            complementAmount: sumBy(upcoming, 'complementAmount'),
            endOfStayComplementAmount: sumBy(upcoming, 'endOfStayComplementAmount'),
            // Σ still-owed buckets — drives the « En attente de paiement » chip of the upcoming
            // payments table (specs/finance-upcoming-payments-table.md §3 rule 6).
            remainingToPay: sumBy(upcoming, 'remainingToPay'),
            totalSejour: sumBy(upcoming, 'totalSejour'),
          },
        },
      };
    },

    // Tourist-tax extraction up to and including the current month (direct bookings only).
    // Future months are still rejected — there's nothing to declare yet.
    getTouristTaxExtraction({ month } = {}) {
      const bounds = getMonthBounds(month);
      if (!bounds) {
        return { ok: false, status: 400, error: 'Mois invalide. Format attendu: YYYY-MM.' };
      }

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      if (month > currentMonth) {
        return { ok: false, status: 400, error: 'Les mois futurs ne sont pas autorisés.' };
      }

      const rows = database.prepare(`
        SELECT
          r.id as reservationId,
          r.propertyId,
          p.name as propertyName,
          c.firstName,
          c.lastName,
          r.startDate,
          r.endDate,
          r.adults,
          r.children,
          r.teens,
          r.babies,
          COALESCE(r.discountPercent, 0) as discountPercent,
          COALESCE(r.extraGuestSurchargeOffered, 0) as extraGuestSurchargeOffered,
          COALESCE(r.touristTaxRate, 0) as storedTaxRate,
          COALESCE(r.touristTaxTotal, 0) as storedTaxAmount,
          COALESCE(p.touristTaxPerDayPerPerson, 0) as propertyTaxRate,
          COALESCE(p.touristTaxMode, 'per_day_per_person') as touristTaxMode,
          COALESCE(p.touristTaxPercentage, 0) as touristTaxPercentage,
          COALESCE(p.touristTaxDepartmentPercentage, 0) as touristTaxDepartmentPercentage,
          COALESCE(p.touristTaxFixedAmount, 0) as touristTaxFixedAmount,
          COALESCE(p.basePriceIncludedGuests, 0) as basePriceIncludedGuests,
          COALESCE(p.extraGuestPrice, 0) as extraGuestPrice,
          COALESCE((SELECT vatRate FROM app_settings WHERE id = 1), 10) as accommodationVatRate,
          MAX(0,
            CAST(
              JULIANDAY(r.endDate) - JULIANDAY(r.startDate)
              AS INTEGER
            )
          ) as nightsCount,
          COALESCE(
            (
              SELECT COUNT(1)
              FROM reservation_nights rn
              WHERE rn.reservationId = r.id
            ),
            0
          ) as nightlyBreakdownCount,
          COALESCE(
            (
            SELECT ROUND(SUM(rn.price), 2)
            FROM reservation_nights rn
            WHERE rn.reservationId = r.id
            ),
            COALESCE(r.totalPrice, 0),
            0
          ) as accommodationRawAmount,
          COALESCE((SELECT SUM(ro.totalPrice) FROM reservation_options ro WHERE ro.reservationId = r.id), 0) as optionsTotal,
          COALESCE((SELECT SUM(rr.totalPrice) FROM reservation_resources rr WHERE rr.reservationId = r.id), 0) as resourcesTotal,
          COALESCE(r.finalPrice, 0) as finalPrice,
          r.touristTaxDeclaredAt as touristTaxDeclaredAt,
          ${REFUNDED_TAX_COLS},
          DATE(r.endDate, '-1 day') as lastNightDate
        FROM reservations r
        JOIN properties p ON p.id = r.propertyId
        JOIN clients c ON c.id = r.clientId
        WHERE r.kind = 'reservation'
          -- specs/tourist-tax-declaration-month-stay-end.md — the declaration follows the STAY: a stay
          -- is declared in the month of its LAST NIGHT (DATE(endDate,'-1 day')), unless its tax-carrying
          -- échéance is paid LATER → then the payment month (never retroactively into an already-declared
          -- past month). Payment stays a GATE: an unpaid stay never appears, so a never-collected tax is
          -- never remitted. Attribution date = MAX(lastNight, paidDate); a NULL paid date (legacy rows
          -- with the paid flag set) falls back to the last night. Normally the tax rides on the SOLDE →
          -- balancePaidDate; collected on arrival (forced to complement, or a platform mode where WE
          -- collect at arrival) → complementPaidDate.
          AND (
            ( NOT ${TAX_ON_ARRIVAL_SQL} AND r.balancePaid = 1
              AND MAX(DATE(r.endDate, '-1 day'), COALESCE(DATE(r.balancePaidDate), DATE(r.endDate, '-1 day'))) >= ?
              AND MAX(DATE(r.endDate, '-1 day'), COALESCE(DATE(r.balancePaidDate), DATE(r.endDate, '-1 day'))) < ? )
            OR
            ( ${TAX_ON_ARRIVAL_SQL} AND r.complementPaid = 1
              AND MAX(DATE(r.endDate, '-1 day'), COALESCE(DATE(r.complementPaidDate), DATE(r.endDate, '-1 day'))) >= ?
              AND MAX(DATE(r.endDate, '-1 day'), COALESCE(DATE(r.complementPaidDate), DATE(r.endDate, '-1 day'))) < ? )
          )
          AND (
            -- specs/per-platform-tourist-tax-three-way.md — the « Taxe de séjour » page lists every
            -- stay WE must remit to the commune: direct, the new "platform collects then reverses it
            -- to us" (case 1), and "we collect at arrival" (case 3) — i.e. everything whose GLOBAL
            -- platform mode has touristTaxRemittedByPlatform = 0. Only "platform collects + remits to
            -- the commune itself" (case 2) is excluded.
            r.platform = 'direct'
            -- Manual reservations store the concatenated label (= platforms.name) → direct match.
            OR EXISTS (
              SELECT 1 FROM platforms pl
              WHERE lower(pl.name) = lower(r.platform)
                AND pl.touristTaxRemittedByPlatform = 0
            )
            -- iCal imports store the hyphenated platformKey → bridge to the canonical label via any
            -- ical_sources row, then read the global mode. (The key→label map is platform-wide.)
            OR EXISTS (
              SELECT 1 FROM ical_sources s
              JOIN platforms pl ON lower(pl.name) = lower(s.platformLabel)
              WHERE (lower(s.platformKey) = lower(r.platform) OR lower(s.platformLabel) = lower(r.platform))
                AND pl.touristTaxRemittedByPlatform = 0
            )
          )
        ORDER BY p.name, r.startDate, c.lastName, c.firstName
      `).all(bounds.start, bounds.endExclusive, bounds.start, bounds.endExclusive);

      // specs/tourist-tax-included-services-deduction.md rule 14 — this page does NOT re-derive the
      // tax from SQL any more: it REPLAYS THE PRICING ENGINE on each stay, from the very inputs the
      // fiche replays (`buildReservationEngineInput`). It used to keep its own arithmetic —
      // accommodation after discount, its own surcharge handling, its own base — and that arithmetic
      // drifted: the same stay could be validated at 13,05 € on its fiche and declared 14,85 € here.
      // One stay, one amount, one engine. What stays this page's own business is WHICH stays it lists
      // (the attribution month, the payment gate, the platform mode) and the refunded-nights prorata.
      const storedById = new Map(
        (rows.length === 0 ? [] : database
          .prepare(`SELECT * FROM reservations WHERE id IN (${rows.map(() => '?').join(', ')})`)
          .all(...rows.map((row) => row.reservationId)))
          .map((r) => [Number(r.id), r]),
      );
      // specs/tourist-tax-freeze-past-with-refresh.md — the fiche freezes the tax of a stay whose last
      // night falls before the 1st of the current month and shows the stored amount. Same rule here,
      // or the declaration of a past month would drift away from the fiches it declares.
      const firstOfCurrentMonth = `${currentMonth}-01`;

      const reservations = rows
        .map((row) => {
          const stored = storedById.get(Number(row.reservationId));
          if (!stored) return null;
          const nightsCount = Number(row.nightsCount || 0);
          const adults = Number(row.adults || 0);
          const children = Number(row.children || 0);
          const teens = Number(row.teens || 0);
          const isPastStay = String(row.lastNightDate || '') < firstOfCurrentMonth;
          const quote = calculateReservationQuote({
            ...buildReservationEngineInput(database, stored),
            freezeTouristTax: isPastStay,
            frozenTouristTaxTotal: stored.touristTaxTotal,
            frozenTouristTaxRate: stored.touristTaxRate,
          });
          const isPercentageMode = String(row.touristTaxMode || '').startsWith('percentage');

          // specs/reservation-refunds.md §3.5 rules 29–31 — a refunded tourist tax is a night the guest
          // did not spend: that night leaves the declaration, and with it its taxable person-nights and
          // its share of the tax.
          //
          // What is deducted is the NIGHT, and the amount follows from it — never the refunded euros
          // themselves. Two reasons: the page recomputes the tax from the property's current rate (it
          // may differ by cents from what was billed), so subtracting a foreign amount would break its
          // own `taxe = nuitées × tarif` arithmetic; and what is owed to the commune depends on nights
          // occupied, not on what the operator kept. A goodwill refund too small to free a whole night
          // therefore changes nothing here.
          const refundedTaxNights = Math.min(nightsCount, Math.max(0, Math.round(Number(row.refundedTaxNights || 0))));
          const declaredNights = Math.max(0, nightsCount - refundedTaxNights);
          const declaredAdultNights = Math.max(
            0,
            Number(quote.touristTaxAdultsCount || 0) * Math.max(0, Number(quote.touristTaxNights || 0) - refundedTaxNights),
          );
          // The tax the fiche shows: frozen on a past stay, recomputed live otherwise.
          const grossTaxAmount = round2(Number(quote.touristTaxTotal || 0));
          const grossAdultNights = Number(quote.touristTaxAdultsCount || 0) * Number(quote.touristTaxNights || 0);
          // Pro-rated on the nights: exact for the per-night modes, the natural share for the
          // percentage ones (where the tax isn't night-linear).
          const declaredTaxAmount = nightsCount > 0
            ? round2(grossTaxAmount * (declaredNights / nightsCount))
            : grossTaxAmount;
          // The annotation reports the declaration's own deduction, so the row always reads
          // « net + retiré = brut » to the cent.
          const refundedTaxAmount = round2(grossTaxAmount - declaredTaxAmount);

          const reservationName = `${row.firstName || ''} ${row.lastName || ''}`.trim();
          return {
            reservationId: row.reservationId,
            propertyId: row.propertyId,
            propertyName: row.propertyName,
            reservationName,
            startDate: row.startDate,
            endDate: row.endDate,
            lastNightDate: row.lastNightDate,
            touristTaxDeclaredAt: row.touristTaxDeclaredAt || null,
            adults,
            children: children + teens,
            // Net of the refunded nights — these are the figures to declare.
            nightsCount: declaredNights,
            adultNights: declaredAdultNights,
            // The per-adult-per-night rate the amount above actually reflects. Derived rather than
            // read from the quote because a FROZEN stay pins `touristTaxUnitAmount` to the stored
            // `touristTaxRate`, which on a percentage property holds the PERCENTAGE (5), not a rate
            // in euros. Identical to the engine's value in every live case.
            taxRate: grossAdultNights > 0
              ? round2(grossTaxAmount / grossAdultNights)
              : round2(Number(quote.touristTaxUnitAmount || 0)),
            taxAmount: declaredTaxAmount,
            // …and what was taken out, so the row can say why (spec §6, « ligne annotée »).
            refundedTaxNights,
            refundedTaxAmount,
            // In percentage mode this column IS the tax base (specs/reservation-refunds.md §6 already
            // called it that): the accommodation the fiche divides by the nights, net of the services
            // included in the rate, HT. Elsewhere no price enters the tax, so it stays the plain
            // accommodation the guest was charged, HT.
            accommodationAmount: isPercentageMode
              ? round2(Number(quote.touristTaxPricePerNightHt || 0) * nightsCount)
              : round2(Number(quote.totalPrice || 0) / (1 + (Number(quote.vatPercentageAccommodation || 0) / 100))),
            // What the rate covered and therefore left the BASE. Zero outside percentage mode, where
            // there is no base for it to leave: the engine still computes it, it just plays no part.
            includedServicesDeduction: isPercentageMode
              ? round2(Number(quote.touristTaxIncludedInRateDeduction || 0))
              : 0,
            // What the commune's percentage form asks for: the cost of one night, per occupant, HT.
            // Null outside percentage mode, where no price enters the tax at all.
            nightPricePerOccupantHt: isPercentageMode
              ? round2(Number(quote.touristTaxPerOccupantNightPriceHt || 0))
              : null,
          };
        })
        .filter(Boolean)
        // `nightsCount` is the NET figure: a stay whose tourist tax was refunded night after night
        // until nothing is left simply leaves the declaration — there is nothing to remit for it
        // (specs/reservation-refunds.md §3.5 rule 31).
        .filter((row) => row.nightsCount > 0);

      const byPropertyMap = new Map();
      for (const row of reservations) {
        if (!byPropertyMap.has(row.propertyId)) {
          byPropertyMap.set(row.propertyId, {
            propertyId: row.propertyId,
            propertyName: row.propertyName,
            reservationsCount: 0,
            nightsCount: 0,
            adultNights: 0,
            taxAmount: 0,
            accommodationAmount: 0,
          });
        }
        const aggregate = byPropertyMap.get(row.propertyId);
        aggregate.reservationsCount += 1;
        aggregate.nightsCount += row.nightsCount;
        aggregate.adultNights += row.adultNights;
        aggregate.taxAmount = round2(aggregate.taxAmount + row.taxAmount);
        aggregate.accommodationAmount = round2(aggregate.accommodationAmount + row.accommodationAmount);
      }

      const byProperty = Array.from(byPropertyMap.values()).sort((a, b) => a.propertyName.localeCompare(b.propertyName, 'fr'));

      const totalAccommodationAmount = round2(reservations.reduce((sum, row) => sum + row.accommodationAmount, 0));
      const totalRentedNights = reservations.reduce((sum, row) => sum + row.nightsCount, 0);
      const totalAdultNights = reservations.reduce((sum, row) => sum + row.adultNights, 0);
      const totalTaxAmount = round2(reservations.reduce((sum, row) => sum + row.taxAmount, 0));

      return {
        ok: true,
        data: {
          month,
          from: bounds.start,
          toExclusive: bounds.endExclusive,
          reservations,
          byProperty,
          totals: {
            reservationsCount: reservations.length,
            rentedNights: totalRentedNights,
            adultNights: totalAdultNights,
            taxAmount: totalTaxAmount,
            accommodationAmount: totalAccommodationAmount,
          },
        },
      };
    },

    // specs/tourist-tax-declared-checkbox.md §3 — the operator ticks « Déclarée » on the extraction page.
    // declared=true stamps the server clock (so we know WHEN it was declared); declared=false clears it.
    setTouristTaxDeclared({ reservationId, declared } = {}) {
      const id = Number(reservationId);
      if (!Number.isInteger(id) || id <= 0) {
        return { ok: false, status: 400, error: 'Réservation invalide.' };
      }
      const exists = database.prepare("SELECT 1 FROM reservations WHERE id = ? AND kind = 'reservation'").get(id);
      if (!exists) {
        return { ok: false, status: 404, error: 'Réservation introuvable.' };
      }
      if (declared) {
        database.prepare("UPDATE reservations SET touristTaxDeclaredAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?").run(id);
      } else {
        database.prepare("UPDATE reservations SET touristTaxDeclaredAt = NULL, updatedAt = datetime('now') WHERE id = ?").run(id);
      }
      const declaredAt = database.prepare('SELECT touristTaxDeclaredAt FROM reservations WHERE id = ?').get(id).touristTaxDeclaredAt || null;
      return { ok: true, data: { declaredAt } };
    },
  };

  return model;
}

const defaultModel = createFinanceModel(db);
defaultModel.buildModel = createFinanceModel;

module.exports = defaultModel;
