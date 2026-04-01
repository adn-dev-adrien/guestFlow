const router = require('express').Router();
const db = require('../database');

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

module.exports = router;
