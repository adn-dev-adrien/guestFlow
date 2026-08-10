// Finance model — all finance DB access + shaping. Returns ready-to-render payloads so the client
// renders only. Payment figures come from the shared computePaymentStatus authority.

const db = require('../database');
const { computeTouristTaxBreakdown } = require('../utils/pricing');
const { computePaymentStatus, round2 } = require('../utils/paymentStatus');
const {
  getMonthBounds,
  computeAccommodationAmountAfterDiscount,
} = require('../utils/financeCalcs');
const {
  isSettled, remainingToPay, platformCommission, midStayNotesTotal, refundsBook, comptaCollected,
} = require('../utils/reservationSettlement');

const UPCOMING_PER_PROPERTY = 5;

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
const BREAKDOWN_METRICS = {
  revenueTotal:   { label: 'Revenu total sur la période',         column: 'Total de séjour', window: 'period' },
  totalCollected: { label: 'Encaissé',                            column: 'Encaissé',        window: 'period' },
  totalPending:   { label: 'En attente de règlement',             column: 'En attente',      window: 'global' },
  yearToDate:     { label: "Revenus depuis le début de l'année",  column: 'Total de séjour', window: 'year' },
  yearTotal:      { label: "Revenu total sur l'année",            column: 'Total de séjour', window: 'year' },
};

function createFinanceModel(database) {
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
    getSummary({ from, to } = {}) {
      const today = todayIso();
      const start = from || today;
      const end = to || '2099-12-31';
      const year = new Date().getFullYear();
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;

      const reservations = database.prepare(`
        SELECT r.*, c.lastName, c.firstName, c.email, p.name as propertyName,
               ${REFUND_COLS}
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation' AND r.endDate >= ? AND r.endDate <= ?
        ORDER BY r.endDate
      `).all(start, end);

      const vatRate = getVatRate(database);
      let revenueTotal = 0;
      let totalCollected = 0;
      let revenueTotalHt = 0;
      let totalCollectedHt = 0;
      // Both per-logement aggregates are seeded from the properties table so every logement is in
      // the payload, 0 included (specs/finance-per-property-revenue-chart.md rule 6).
      const emptyAgg = (p) => ({ propertyId: p.id, propertyName: p.name, revenue: 0, revenueHt: 0 });
      const allProperties = database.prepare('SELECT id, name FROM properties').all();
      const byProperty = new Map(allProperties.map((p) => [p.id, emptyAgg(p)]));
      const yearByProperty = new Map(allProperties.map((p) => [p.id, emptyAgg(p)]));
      const finalizeByProperty = (map) => Array.from(map.values())
        .map((p) => ({ propertyId: p.propertyId, propertyName: p.propertyName, revenue: round2(p.revenue), revenueHt: round2(p.revenueHt) }))
        .sort((a, b) => (b.revenue - a.revenue) || a.propertyName.localeCompare(b.propertyName, 'fr'));

      const enriched = reservations.map((r) => {
        const stay = totalSejour(r);
        const stayHt = htAmount(r, stay, vatRate);
        const settled = isSettled(r);
        const collected = comptaCollected(r);
        revenueTotal += stay;
        revenueTotalHt += stayHt;
        totalCollected += collected;
        totalCollectedHt += htAmount(r, collected, vatRate);

        const agg = byProperty.get(r.propertyId)
          || { propertyId: r.propertyId, propertyName: r.propertyName, revenue: 0, revenueHt: 0 };
        agg.revenue += stay;
        agg.revenueHt += stayHt;
        byProperty.set(r.propertyId, agg);

        const status = computePaymentStatus(r, today);
        return {
          ...r,
          totalSejour: stay,
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

      // Year cards (by endDate), independent of the selected period.
      const yearRows = database.prepare(`
        SELECT depositAmount, balanceAmount, complementAmount, complementPaidCash,
               endOfStayComplementAmount, endOfStayComplementPaidCash, midStaySettledNotes, endDate,
               finalPrice, touristTaxTotal, platformCommissionAmount, acompteCommissionAmount,
               r.propertyId, p.name AS propertyName,
               ${REFUND_COLS}
        FROM reservations r JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation' AND r.endDate >= ? AND r.endDate <= ?
      `).all(yearStart, yearEnd);
      let yearToDate = 0;
      let yearTotal = 0;
      let yearToDateHt = 0;
      let yearTotalHt = 0;
      for (const r of yearRows) {
        const stay = totalSejour(r);
        const stayHt = htAmount(r, stay, vatRate);
        yearTotal += stay;
        yearTotalHt += stayHt;
        if (r.endDate <= today) {
          yearToDate += stay;
          yearToDateHt += stayHt;
          const agg = yearByProperty.get(r.propertyId)
            || { propertyId: r.propertyId, propertyName: r.propertyName, revenue: 0, revenueHt: 0 };
          agg.revenue += stay;
          agg.revenueHt += stayHt;
          yearByProperty.set(r.propertyId, agg);
        }
      }
      const yearToDateByProperty = finalizeByProperty(yearByProperty);

      return {
        revenueTotal:   round2(revenueTotal),   // Σ total-séjour over the period (by endDate)
        revenueTotalHt: round2(revenueTotalHt), // …its element-by-element HT (tax excluded, ÷ vat)
        totalCollected: round2(totalCollected), // accounting total (encaissé)
        totalCollectedHt: round2(totalCollectedHt),
        totalPending:   round2(totalPending),   // Σ remainingToPay of ALL past + non-settled (global)
        totalPendingHt: round2(totalPendingHt),
        yearToDate:     round2(yearToDate),      // Σ total-séjour, Jan 1 → today
        yearToDateHt:   round2(yearToDateHt),
        yearTotal:      round2(yearTotal),       // Σ total-séjour, full calendar year
        yearTotalHt:    round2(yearTotalHt),
        reservations:   enriched,
        revenueByProperty,      // period, per logement (+ revenueHt, zero-seeded)
        yearToDateByProperty,   // Jan 1 → today, per logement (same shape)
      };
    },

    // specs/finance-card-breakdown.md — the reservations behind a single card figure, with one amount
    // column whose Σ equals the card. Reuses the SAME per-reservation helpers as getSummary so the total
    // is coherent by construction. Period metrics honour the du/au range; annual metrics use the calendar
    // year computed here (the from/to are ignored for them).
    getBreakdown({ metric, from, to } = {}) {
      const def = BREAKDOWN_METRICS[metric];
      if (!def) return { ok: false, status: 400, error: 'Métrique inconnue.' };

      const today = todayIso();
      const vatRate = getVatRate(database);

      const selectRows = (start, end) => database.prepare(`
        SELECT r.*, c.lastName, c.firstName, p.name as propertyName,
               ${REFUND_COLS}
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation' AND r.endDate >= ? AND r.endDate <= ?
        ORDER BY r.endDate
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
        const year = new Date().getFullYear();
        const yearStart = `${year}-01-01`;
        const yearEnd = `${year}-12-31`;
        rows = selectRows(yearStart, yearEnd);
        windowMeta = { kind: 'year', year, from: yearStart, to: yearEnd };
      }

      // include = does this reservation contribute to the figure; amount = its contribution. Mirrors the
      // exact predicates getSummary applies for each figure (a non-contributing row would just add 0).
      const contribution = (r) => {
        switch (metric) {
          case 'totalCollected': { const amount = comptaCollected(r); return { include: amount > 0, amount }; }
          // Restant dû of every finished, non-settled stay (period-free — spec above).
          case 'totalPending':   return { include: r.endDate < today && !isSettled(r), amount: remainingToPay(r) };
          case 'yearToDate':     return { include: r.endDate <= today, amount: totalSejour(r) };
          case 'revenueTotal':
          case 'yearTotal':
          default:               return { include: true, amount: totalSejour(r) };
        }
      };

      let total = 0;
      let totalHt = 0;
      const outRows = [];
      for (const r of rows) {
        const { include, amount } = contribution(r);
        if (!include) continue;
        const amountHt = htAmount(r, amount, vatRate);
        total += amount;
        totalHt += amountHt;
        outRows.push({
          id: r.id,
          clientName: `${r.firstName} ${r.lastName}`.trim(),
          propertyName: r.propertyName,
          platform: r.platform,
          startDate: r.startDate,
          endDate: r.endDate,
          amount: round2(amount),
          amountHt,
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
          rows: outRows,
        },
      };
    },

    // Projection by a target date (specs/finance-overview-rework.md §3.4): the revenue realised by that
    // date = Σ total-de-séjour of reservations whose departure (endDate) is on/before it, split into the
    // accounting « encaissé » and the rest still « en attente ».
    getProjection({ date } = {}) {
      const targetDate = date || todayIso();

      const reservations = database.prepare(`
        SELECT r.*, c.lastName, c.firstName, c.email, p.name as propertyName,
               ${REFUND_COLS}
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation' AND r.endDate <= ?
        ORDER BY r.endDate
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

      const reservations = rows
        .map((row) => {
          const nightsCount = Number(row.nightsCount || 0);
          const adults = Number(row.adults || 0);
          const children = Number(row.children || 0);
          const teens = Number(row.teens || 0);
          const babies = Number(row.babies || 0);
          const accommodationMeta = computeAccommodationAmountAfterDiscount({
            accommodationRawAmount: row.accommodationRawAmount,
            optionsTotal: row.optionsTotal,
            resourcesTotal: row.resourcesTotal,
            finalPrice: row.finalPrice,
            accommodationVatRate: row.accommodationVatRate,
            discountPercent: row.discountPercent,
          });
          const surchargePersonCount = adults + children + teens;
          const includedGuests = Math.max(0, Number(row.basePriceIncludedGuests || 0));
          const extraGuestCount = Math.max(0, surchargePersonCount - includedGuests);
          const extraGuestUnitPrice = Math.max(0, Number(row.extraGuestPrice || 0));
          const extraGuestSurcharge = Number(row.extraGuestSurchargeOffered || 0) === 1
            ? 0
            : round2(extraGuestCount * extraGuestUnitPrice);
          const hasNightlyBreakdown = Number(row.nightlyBreakdownCount || 0) > 0;
          const surchargeToExcludeFromReference = hasNightlyBreakdown ? 0 : extraGuestSurcharge;

          const accommodationReferenceTtc = round2(Math.max(0, accommodationMeta.accommodationTtcAmount - surchargeToExcludeFromReference));
          const touristTaxBreakdown = computeTouristTaxBreakdown({
            touristTaxMode: row.touristTaxMode,
            touristTaxPerDayPerPerson: row.propertyTaxRate,
            touristTaxPercentage: row.touristTaxPercentage,
            touristTaxDepartmentPercentage: row.touristTaxDepartmentPercentage,
            touristTaxFixedAmount: row.touristTaxFixedAmount,
            nights: nightsCount,
            adults,
            occupants: adults + children + teens + babies,
            accommodationAmountTtc: accommodationReferenceTtc,
            accommodationVatRate: row.accommodationVatRate,
          });

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
            touristTaxBreakdown.touristTaxAdultsCount * Math.max(0, touristTaxBreakdown.touristTaxNights - refundedTaxNights),
          );
          const grossTaxAmount = round2(touristTaxBreakdown.touristTaxTotal);
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
            taxRate: touristTaxBreakdown.touristTaxUnitAmount,
            taxAmount: declaredTaxAmount,
            // …and what was taken out, so the row can say why (spec §6, « ligne annotée »).
            refundedTaxNights,
            refundedTaxAmount,
            accommodationRawAmount: accommodationMeta.accommodationRawAmount,
            reductionAmount: accommodationMeta.reductionAmount,
            accommodationAmount: accommodationMeta.accommodationAmount,
          };
        })
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
