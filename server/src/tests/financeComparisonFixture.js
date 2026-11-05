// Shared fixture of the RevPAR / year-over-year suites (specs/finance-revpar-year-over-year.md). Not a
// test file. Two exercises long over (2023, 2024), so the figures never move with the calendar: a past
// day stays past. 2024 is a leap year; January and February 2024 are closed for every logement, and the
// Tente is closed in December 2024.
// « date-literal-ok »: rows of a closed exercise written straight to the table (no write path, no date
// window), and every suite reading them pins its clock (mock.timers) so that « today » never moves either.

const { freshDb, insert } = require('./financeDashboardFixture');

const LONG_AGO = '2023-01-02 10:00:00'; // date-literal-ok

function pinnedDashboard() {
  const ctx = freshDb({ properties: ['Gite', 'Tente'] });
  const { db } = ctx;
  db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (NULL, 'Hiver', '2024-01-01', '2024-03-01')").run(); // date-literal-ok
  db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (2, 'Tente pliée', '2024-12-01', '2025-01-01')").run(); // date-literal-ok
  // Fixed ids: the shared fixture's counter runs across every suite of a process.
  let id = 0;
  const paid = (r) => insert(db, { id: (id += 1), createdAt: LONG_AGO, balancePaid: 1, ...r });
  // 2023 — last year of the pinned exercise.
  paid({ propertyId: 1, startDate: '2023-05-01', endDate: '2023-05-03', balanceAmount: 200, balancePaidDate: '2023-05-03' }); // date-literal-ok
  paid({ propertyId: 1, startDate: '2023-07-10', endDate: '2023-07-15', balanceAmount: 500, balancePaidDate: '2023-07-15' }); // date-literal-ok
  paid({ propertyId: 2, startDate: '2023-08-01', endDate: '2023-08-04', balanceAmount: 300, balancePaidDate: '2023-08-04' }); // date-literal-ok
  // 2024 — the pinned exercise.
  paid({ propertyId: 1, startDate: '2024-07-08', endDate: '2024-07-14', depositAmount: 200, depositPaid: 1, depositPaidDate: '2024-05-01', balanceAmount: 500, balancePaidDate: '2024-07-14' }); // date-literal-ok
  paid({ propertyId: 2, startDate: '2024-08-02', endDate: '2024-08-06', balanceAmount: 400, balancePaidDate: '2024-08-06' }); // date-literal-ok
  paid({ propertyId: 2, startDate: '2024-09-10', endDate: '2024-09-13', platform: 'Booking', balanceAmount: 330, platformCommissionAmount: 30, balancePaidDate: '2024-09-20' }); // date-literal-ok
  paid({ propertyId: 1, startDate: '2024-10-01', endDate: '2024-10-03', balanceAmount: 0, balancePaidDate: '2024-10-03' }); // date-literal-ok
  // Attributed to 2025 (solde paid then), two of its nights in December 2024.
  paid({ propertyId: 1, startDate: '2024-12-30', endDate: '2025-01-02', balanceAmount: 300, balancePaidDate: '2025-01-02' }); // date-literal-ok
  return ctx;
}

// The fields this spec adds to GET /api/finance/dashboard (rules 1-3, 8, 12).
const ADDED = { hero: ['revPar', 'openNights', 'occupiedNights'], data: ['occupancyAll', 'comparison'] };

// The dashboard payload as it was before this spec: the added fields removed. `fiscalYears` (the
// selector's options) grows with the calendar and is left out of the pin.
function withoutAdded(data) {
  const copy = JSON.parse(JSON.stringify(data));
  for (const k of ADDED.hero) delete copy.hero[k];
  for (const k of ADDED.data) delete copy[k];
  delete copy.fiscalYears;
  return copy;
}

module.exports = { pinnedDashboard, withoutAdded, ADDED, LONG_AGO };
