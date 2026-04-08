const router = require('express').Router();
const db = require('../database');

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getMonthBounds(monthStr) {
  if (!/^\d{4}-\d{2}$/.test(monthStr || '')) return null;
  const [y, m] = monthStr.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  const start = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
  const nextMonthDate = new Date(Date.UTC(y, m, 1));
  const endExclusive = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}-01`;
  return { start, endExclusive };
}

function getLastNightDate(endDate) {
  const end = new Date(`${String(endDate || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return '';
  end.setUTCDate(end.getUTCDate() - 1);
  return `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`;
}

function isReservationAssignedToMonth({ endDate, monthBounds }) {
  if (!monthBounds?.start || !monthBounds?.endExclusive) return false;
  const lastNightDate = getLastNightDate(endDate);
  if (!lastNightDate) return false;
  return lastNightDate >= monthBounds.start && lastNightDate < monthBounds.endExclusive;
}

function computeAccommodationAmountAfterDiscount({ accommodationRawAmount, optionsTotal, resourcesTotal, finalPrice }) {
  const raw = Math.max(0, Number(accommodationRawAmount || 0));
  const options = Math.max(0, Number(optionsTotal || 0));
  const resources = Math.max(0, Number(resourcesTotal || 0));
  const subtotal = raw + options + resources;
  const final = Math.max(0, Number(finalPrice || 0));
  const reductionAmount = Math.max(0, subtotal - final);
  const accommodationReduction = subtotal > 0
    ? reductionAmount * (raw / subtotal)
    : 0;
  const net = round2(Math.max(0, raw - accommodationReduction));
  return {
    accommodationRawAmount: round2(raw),
    reductionAmount: round2(reductionAmount),
    accommodationAmount: net,
  };
}

function computeTouristTaxAmount({ nightsCount, adults, taxRate }) {
  const nights = Math.max(0, Number(nightsCount || 0));
  const adultsCount = Math.max(0, Number(adults || 0));
  const rate = Math.max(0, Number(taxRate || 0));
  const adultNights = nights * adultsCount;
  return {
    adultNights,
    taxAmount: round2(adultNights * rate),
  };
}

// Financial summary for a date range
router.get('/summary', (req, res) => {
  const { from, to } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const start = from || today;
  const end = to || '2099-12-31';

  // Reservations in period
  const reservations = db.prepare(`
    SELECT r.*, c.lastName, c.firstName, c.email, p.name as propertyName
    FROM reservations r
    JOIN clients c ON r.clientId = c.id
    JOIN properties p ON r.propertyId = p.id
    WHERE r.startDate <= ? AND r.endDate >= ?
    ORDER BY r.startDate
  `).all(end, start);

  let totalRevenue = 0;
  let totalCollected = 0;
  let totalPending = 0;

  for (const r of reservations) {
    totalRevenue += r.finalPrice;
    if (r.depositPaid) totalCollected += r.depositAmount;
    if (r.balancePaid) totalCollected += r.balanceAmount;
    if (!r.depositPaid) totalPending += r.depositAmount;
    if (!r.balancePaid) totalPending += r.balanceAmount;
  }

  res.json({
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalCollected: Math.round(totalCollected * 100) / 100,
    totalPending: Math.round(totalPending * 100) / 100,
    reservations
  });
});

// Projection at a given date: show what's collected and expected
router.get('/projection', (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];

  const reservations = db.prepare(`
    SELECT r.*, c.lastName, c.firstName, c.email, p.name as propertyName
    FROM reservations r
    JOIN clients c ON r.clientId = c.id
    JOIN properties p ON r.propertyId = p.id
    ORDER BY r.startDate
  `).all();

  let collected = 0;
  let expectedByDate = 0;
  const details = [];

  for (const r of reservations) {
    let depositCollected = r.depositPaid ? r.depositAmount : 0;
    let balanceCollected = r.balancePaid ? r.balanceAmount : 0;
    let depositExpected = 0;
    let balanceExpected = 0;

    if (!r.depositPaid && r.depositDueDate && r.depositDueDate <= targetDate) {
      depositExpected = r.depositAmount;
    }
    if (!r.balancePaid && r.balanceDueDate && r.balanceDueDate <= targetDate) {
      balanceExpected = r.balanceAmount;
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
        balanceExpected
      });
    }
  }

  res.json({
    targetDate,
    collected: Math.round(collected * 100) / 100,
    expectedByDate: Math.round(expectedByDate * 100) / 100,
    total: Math.round((collected + expectedByDate) * 100) / 100,
    details
  });
});

// Pending payments: clients with outstanding payments
router.get('/pending', (req, res) => {
  const reservations = db.prepare(`
    SELECT r.*, c.lastName, c.firstName, c.email, c.phone, p.name as propertyName,
      (r.finalPrice
        - (CASE WHEN r.depositPaid = 1 THEN COALESCE(r.depositAmount, 0) ELSE 0 END)
        - (CASE WHEN r.balancePaid = 1 THEN COALESCE(r.balanceAmount, 0) ELSE 0 END)
      ) as remainingDue
    FROM reservations r
    JOIN clients c ON r.clientId = c.id
    JOIN properties p ON r.propertyId = p.id
    WHERE r.depositPaid = 0
       OR r.balancePaid = 0
       OR (r.depositPaid = 1 AND r.balancePaid = 1 AND (
            r.finalPrice
            - COALESCE(r.depositAmount, 0)
            - COALESCE(r.balanceAmount, 0)
          ) > 0)
    ORDER BY r.depositDueDate, r.balanceDueDate
  `).all();

  res.json(reservations);
});

// Tourist tax extraction by month (past months only)
router.get('/tourist-tax', (req, res) => {
  const { month } = req.query;
  const bounds = getMonthBounds(month);
  if (!bounds) {
    return res.status(400).json({ error: 'Mois invalide. Format attendu: YYYY-MM.' });
  }

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (month >= currentMonth) {
    return res.status(400).json({ error: 'Seuls les mois déjà passés sont autorisés.' });
  }

  const rows = db.prepare(`
    SELECT
      r.id as reservationId,
      r.propertyId,
      p.name as propertyName,
      c.firstName,
      c.lastName,
      r.startDate,
      r.endDate,
      r.adults,
      COALESCE(p.touristTaxPerDayPerPerson, 0) as taxRate,
      MAX(0,
        CAST(
          JULIANDAY(r.endDate) - JULIANDAY(r.startDate)
          AS INTEGER
        )
      ) as nightsCount,
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
    WHERE DATE(r.endDate, '-1 day') >= ?
      AND DATE(r.endDate, '-1 day') < ?
      AND r.platform = 'direct'
    ORDER BY p.name, r.startDate, c.lastName, c.firstName
  `).all(
    bounds.start,
    bounds.endExclusive
  );

  const reservations = rows
    .map((row) => {
      const nightsCount = Number(row.nightsCount || 0);
      const adults = Number(row.adults || 0);
      const taxRate = Math.max(0, Number(row.taxRate || 0));
      const taxMeta = computeTouristTaxAmount({ nightsCount, adults, taxRate });
      const accommodationMeta = computeAccommodationAmountAfterDiscount({
        accommodationRawAmount: row.accommodationRawAmount,
        optionsTotal: row.optionsTotal,
        resourcesTotal: row.resourcesTotal,
        finalPrice: row.finalPrice,
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
        nightsCount,
        adultNights: taxMeta.adultNights,
        taxRate,
        taxAmount: taxMeta.taxAmount,
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
    aggregate.taxAmount = Math.round((aggregate.taxAmount + row.taxAmount) * 100) / 100;
    aggregate.accommodationAmount = Math.round((aggregate.accommodationAmount + row.accommodationAmount) * 100) / 100;
  }

  const byProperty = Array.from(byPropertyMap.values()).sort((a, b) => a.propertyName.localeCompare(b.propertyName, 'fr'));

  const totalAccommodationAmount = Math.round(reservations.reduce((sum, row) => sum + row.accommodationAmount, 0) * 100) / 100;
  const totalRentedNights = reservations.reduce((sum, row) => sum + row.nightsCount, 0);
  const totalAdultNights = reservations.reduce((sum, row) => sum + row.adultNights, 0);
  const totalTaxAmount = Math.round(reservations.reduce((sum, row) => sum + row.taxAmount, 0) * 100) / 100;
  const totalReservations = reservations.length;

  return res.json({
    month,
    from: bounds.start,
    toExclusive: bounds.endExclusive,
    reservations,
    byProperty,
    totals: {
      reservationsCount: totalReservations,
      rentedNights: totalRentedNights,
      adultNights: totalAdultNights,
      taxAmount: totalTaxAmount,
      accommodationAmount: totalAccommodationAmount,
    },
  });
});

module.exports = router;
module.exports.__test = {
  getMonthBounds,
  getLastNightDate,
  isReservationAssignedToMonth,
  computeAccommodationAmountAfterDiscount,
  computeTouristTaxAmount,
};
