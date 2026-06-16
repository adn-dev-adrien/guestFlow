// Finance model — all finance DB access + shaping. Returns ready-to-render payloads so the client
// renders only. Payment figures come from the shared computePaymentStatus authority.

const db = require('../database');
const { computeTouristTaxBreakdown } = require('../utils/pricing');
const { computePaymentStatus, round2 } = require('../utils/paymentStatus');
const {
  getMonthBounds,
  computeAccommodationAmountAfterDiscount,
} = require('../utils/financeCalcs');

const UPCOMING_PER_PROPERTY = 5;

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function nightsBetween(startDate, endDate) {
  const ms = new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.round(ms / 86400000));
}

// specs/finance-overview-rework.md §3.1 — the « total de séjour » = the headline stay value used as the
// single revenue unit: acompte + solde + complément d'arrivée + complément de fin de séjour, with BOTH
// complements EXCLUDED when settled via caisse interne (off-books, decision 2026-06-16).
function totalSejour(r) {
  const deposit = Number(r.depositAmount || 0);
  const balance = Number(r.balanceAmount || 0);
  const complement = r.complementPaidCash ? 0 : Number(r.complementAmount || 0);
  const endOfStay = r.endOfStayComplementPaidCash ? 0 : Number(r.endOfStayComplementAmount || 0);
  return round2(deposit + balance + complement + endOfStay);
}

// specs/finance-overview-rework.md §3.3 — a reservation is « soldé » when every applicable component is
// paid OR marked caisse interne. A zero-amount component is trivially settled.
function isSettled(r) {
  // A zero-amount component is trivially settled; otherwise it must be paid (or, for the complements,
  // marked caisse interne). Deposit also counts as settled when disabled per-reservation.
  const depOk = Number(r.depositAmount || 0) === 0 || Boolean(r.depositDisabled) || Boolean(r.depositPaid);
  const balOk = Number(r.balanceAmount || 0) === 0 || Boolean(r.balancePaid);
  const compOk = Number(r.complementAmount || 0) === 0 || Boolean(r.complementPaid) || Boolean(r.complementPaidCash);
  const eosOk = Number(r.endOfStayComplementAmount || 0) === 0 || Boolean(r.endOfStayComplementPaid) || Boolean(r.endOfStayComplementPaidCash);
  return depOk && balOk && compOk && eosOk;
}

// « Encaissé » = the accounting total (specs/finance-overview-rework.md §3.2): every component marked paid
// EXCLUDING caisse interne, so it equals what the compta export sums. (Deposit/balance carry no cash flag.)
function comptaCollected(r) {
  return round2(
    (r.depositPaid ? Number(r.depositAmount || 0) : 0)
    + (r.balancePaid ? Number(r.balanceAmount || 0) : 0)
    + (r.complementPaid && !r.complementPaidCash ? Number(r.complementAmount || 0) : 0)
    + (r.endOfStayComplementPaid && !r.endOfStayComplementPaidCash ? Number(r.endOfStayComplementAmount || 0) : 0),
  );
}

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

function createFinanceModel(database) {
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
    // (which was unreadable when many reservations stacked up). Sorted descending by revenue.
    // specs/finance-overview-rework.md §3.2 — every revenue figure is Σ « total de séjour », a reservation
    // counted by its DEPARTURE date (endDate). The period uses the du/au range; two extra figures cover
    // the calendar year (to-date + full). « Encaissé » = the accounting total (comptaCollected). « En
    // attente » = Σ total-séjour of PAST (endDate < today) + non-settled reservations of the period.
    getSummary({ from, to } = {}) {
      const today = todayIso();
      const start = from || today;
      const end = to || '2099-12-31';
      const year = new Date().getFullYear();
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;

      const reservations = database.prepare(`
        SELECT r.*, c.lastName, c.firstName, c.email, p.name as propertyName
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation' AND r.endDate >= ? AND r.endDate <= ?
        ORDER BY r.endDate
      `).all(start, end);

      const vatRate = getVatRate(database);
      let revenueTotal = 0;
      let totalCollected = 0;
      let totalPending = 0;
      let revenueTotalHt = 0;
      let totalCollectedHt = 0;
      let totalPendingHt = 0;
      const byProperty = new Map(); // propertyId → { propertyName, revenue }

      const enriched = reservations.map((r) => {
        const stay = totalSejour(r);
        const settled = isSettled(r);
        const collected = comptaCollected(r);
        revenueTotal += stay;
        revenueTotalHt += htAmount(r, stay, vatRate);
        totalCollected += collected;
        totalCollectedHt += htAmount(r, collected, vatRate);
        if (r.endDate < today && !settled) { totalPending += stay; totalPendingHt += htAmount(r, stay, vatRate); }

        const agg = byProperty.get(r.propertyId)
          || { propertyId: r.propertyId, propertyName: r.propertyName, revenue: 0 };
        agg.revenue += stay;
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

      const revenueByProperty = Array.from(byProperty.values())
        .map((p) => ({ propertyId: p.propertyId, propertyName: p.propertyName, revenue: round2(p.revenue) }))
        .sort((a, b) => b.revenue - a.revenue);

      // Year cards (by endDate), independent of the selected period.
      const yearRows = database.prepare(`
        SELECT depositAmount, balanceAmount, complementAmount, complementPaidCash,
               endOfStayComplementAmount, endOfStayComplementPaidCash, endDate,
               finalPrice, touristTaxTotal
        FROM reservations WHERE kind = 'reservation' AND endDate >= ? AND endDate <= ?
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
        if (r.endDate <= today) { yearToDate += stay; yearToDateHt += stayHt; }
      }

      return {
        revenueTotal:   round2(revenueTotal),   // Σ total-séjour over the period (by endDate)
        revenueTotalHt: round2(revenueTotalHt), // …its element-by-element HT (tax excluded, ÷ vat)
        totalCollected: round2(totalCollected), // accounting total (encaissé)
        totalCollectedHt: round2(totalCollectedHt),
        totalPending:   round2(totalPending),   // Σ total-séjour of past + non-settled
        totalPendingHt: round2(totalPendingHt),
        yearToDate:     round2(yearToDate),      // Σ total-séjour, Jan 1 → today
        yearToDateHt:   round2(yearToDateHt),
        yearTotal:      round2(yearTotal),       // Σ total-séjour, full calendar year
        yearTotalHt:    round2(yearTotalHt),
        reservations:   enriched,
        revenueByProperty,
      };
    },

    // Projection by a target date (specs/finance-overview-rework.md §3.4): the revenue realised by that
    // date = Σ total-de-séjour of reservations whose departure (endDate) is on/before it, split into the
    // accounting « encaissé » and the rest still « en attente ».
    getProjection({ date } = {}) {
      const targetDate = date || todayIso();

      const reservations = database.prepare(`
        SELECT r.*, c.lastName, c.firstName, c.email, p.name as propertyName
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
        SELECT r.*, c.lastName, c.firstName, c.email, c.phone, p.name as propertyName
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
            totalSejour: sumBy(upcoming, 'totalSejour'),
          },
        },
      };
    },

    // Tourist-tax extraction for a past month (direct bookings only).
    getTouristTaxExtraction({ month } = {}) {
      const bounds = getMonthBounds(month);
      if (!bounds) {
        return { ok: false, status: 400, error: 'Mois invalide. Format attendu: YYYY-MM.' };
      }

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      if (month >= currentMonth) {
        return { ok: false, status: 400, error: 'Seuls les mois déjà passés sont autorisés.' };
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
          DATE(r.endDate, '-1 day') as lastNightDate
        FROM reservations r
        JOIN properties p ON p.id = r.propertyId
        JOIN clients c ON c.id = r.clientId
        WHERE r.kind = 'reservation'
          AND DATE(r.endDate, '-1 day') >= ?
          AND DATE(r.endDate, '-1 day') < ?
          AND (
            r.platform = 'direct'
            OR EXISTS (
              SELECT 1 FROM ical_sources s
              WHERE s.propertyId = r.propertyId
                AND lower(s.platformKey) = lower(r.platform)
                AND s.collectsTouristTax = 0
            )
          )
        ORDER BY p.name, r.startDate, c.lastName, c.firstName
      `).all(bounds.start, bounds.endExclusive);

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

          const reservationName = `${row.firstName || ''} ${row.lastName || ''}`.trim();
          return {
            reservationId: row.reservationId,
            propertyId: row.propertyId,
            propertyName: row.propertyName,
            reservationName,
            startDate: row.startDate,
            endDate: row.endDate,
            lastNightDate: row.lastNightDate,
            adults,
            children: children + teens,
            nightsCount,
            adultNights: touristTaxBreakdown.touristTaxAdultsCount * touristTaxBreakdown.touristTaxNights,
            taxRate: touristTaxBreakdown.touristTaxUnitAmount,
            taxAmount: touristTaxBreakdown.touristTaxTotal,
            accommodationRawAmount: accommodationMeta.accommodationRawAmount,
            reductionAmount: accommodationMeta.reductionAmount,
            accommodationAmount: accommodationMeta.accommodationAmount,
          };
        })
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
  };

  return model;
}

const defaultModel = createFinanceModel(db);
defaultModel.buildModel = createFinanceModel;

module.exports = defaultModel;
