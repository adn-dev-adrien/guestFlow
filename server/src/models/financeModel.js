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

function createFinanceModel(database) {
  const model = {
    // Financial summary for a date range; each reservation carries its payment status.
    getSummary({ from, to } = {}) {
      const today = todayIso();
      const start = from || today;
      const end = to || '2099-12-31';

      const reservations = database.prepare(`
        SELECT r.*, c.lastName, c.firstName, c.email, p.name as propertyName
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation' AND r.startDate <= ? AND r.endDate >= ?
        ORDER BY r.startDate
      `).all(end, start);

      let totalRevenue = 0;
      let totalCollected = 0;
      let totalPending = 0;

      const enriched = reservations.map((r) => {
        totalRevenue += Number(r.finalPrice || 0);
        if (r.depositPaid) totalCollected += Number(r.depositAmount || 0);
        if (r.balancePaid) totalCollected += Number(r.balanceAmount || 0);
        if (!r.depositPaid) totalPending += Number(r.depositAmount || 0);
        if (!r.balancePaid) totalPending += Number(r.balanceAmount || 0);
        const status = computePaymentStatus(r, today);
        return {
          ...r,
          remainingDue: status.remainingDue,
          depositOverdue: status.depositOverdue,
          balanceOverdue: status.balanceOverdue,
          paymentComplete: status.paymentComplete,
        };
      });

      return {
        totalRevenue: round2(totalRevenue),
        totalCollected: round2(totalCollected),
        totalPending: round2(totalPending),
        reservations: enriched,
      };
    },

    // Projection at a given date: what is collected vs expected by that date.
    getProjection({ date } = {}) {
      const targetDate = date || todayIso();

      const reservations = database.prepare(`
        SELECT r.*, c.lastName, c.firstName, c.email, p.name as propertyName
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation'
        ORDER BY r.startDate
      `).all();

      let collected = 0;
      let expectedByDate = 0;
      const details = [];

      for (const r of reservations) {
        const depositCollected = r.depositPaid ? Number(r.depositAmount || 0) : 0;
        const balanceCollected = r.balancePaid ? Number(r.balanceAmount || 0) : 0;
        let depositExpected = 0;
        let balanceExpected = 0;

        if (!r.depositPaid && r.depositDueDate && r.depositDueDate <= targetDate) {
          depositExpected = Number(r.depositAmount || 0);
        }
        if (!r.balancePaid && r.balanceDueDate && r.balanceDueDate <= targetDate) {
          balanceExpected = Number(r.balanceAmount || 0);
        }

        collected += depositCollected + balanceCollected;
        expectedByDate += depositExpected + balanceExpected;

        if (depositExpected > 0 || balanceExpected > 0 || depositCollected > 0 || balanceCollected > 0) {
          details.push({
            reservationId: r.id,
            clientName: `${r.firstName} ${r.lastName}`,
            propertyName: r.propertyName,
            startDate: r.startDate,
            endDate: r.endDate,
            finalPrice: r.finalPrice,
            depositAmount: r.depositAmount,
            depositPaid: !!r.depositPaid,
            depositDueDate: r.depositDueDate,
            balanceAmount: r.balanceAmount,
            balancePaid: !!r.balancePaid,
            balanceDueDate: r.balanceDueDate,
            depositCollected,
            balanceCollected,
            depositExpected,
            balanceExpected,
          });
        }
      }

      return {
        targetDate,
        collected: round2(collected),
        expectedByDate: round2(expectedByDate),
        total: round2(collected + expectedByDate),
        details,
      };
    },

    // The whole "Suivi opérationnel" section, fully shaped: overdue (sorted + aggregates),
    // pending list, and the flat upcoming list (top-N per property).
    getOperational() {
      const today = todayIso();

      const pendingRows = database.prepare(`
        SELECT r.*, c.lastName, c.firstName, c.email, c.phone, p.name as propertyName
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation'
          AND r.finalPrice IS NOT NULL
          AND (r.depositPaid = 0
           OR r.balancePaid = 0
           OR (r.depositPaid = 1 AND r.balancePaid = 1 AND (
                COALESCE(r.finalPrice, 0)
                - COALESCE(r.depositAmount, 0)
                - COALESCE(r.balanceAmount, 0)
              ) > 0))
        ORDER BY r.depositDueDate, r.balanceDueDate
      `).all();

      const pending = pendingRows.map((r) => ({ ...r, ...computePaymentStatus(r, today) }));

      const overdueReservations = pending
        .filter((r) => r.isOverdue)
        .sort((a, b) => (a.oldestDueDate || '').localeCompare(b.oldestDueDate || ''));
      const overdueTotalAmount = round2(
        overdueReservations.reduce((sum, r) => sum + Number(r.overdueAmount || 0), 0),
      );

      // Upcoming: not-yet-ended reservations, top-N per property by start date, flattened + sorted.
      const upcomingRows = database.prepare(`
        SELECT r.*, c.lastName, c.firstName, c.email, c.phone, p.name as propertyName
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation' AND r.endDate >= ?
        ORDER BY r.startDate
      `).all(today);

      const byProperty = new Map();
      for (const r of upcomingRows) {
        const list = byProperty.get(r.propertyId) || [];
        if (list.length < UPCOMING_PER_PROPERTY) {
          const status = computePaymentStatus(r, today);
          list.push({
            ...r,
            remainingDue: status.remainingDue,
            paymentComplete: status.paymentComplete,
            nights: nightsBetween(r.startDate, r.endDate),
          });
          byProperty.set(r.propertyId, list);
        }
      }
      const upcoming = Array.from(byProperty.values())
        .flat()
        .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

      return {
        overdue: {
          reservations: overdueReservations,
          count: overdueReservations.length,
          totalAmount: overdueTotalAmount,
        },
        pending: { reservations: pending },
        upcoming: { reservations: upcoming },
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
          COALESCE(p.vatPercentageAccommodation, 20) as accommodationVatRate,
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
          AND r.platform = 'direct'
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
