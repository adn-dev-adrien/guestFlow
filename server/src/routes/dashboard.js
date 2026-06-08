/**
 * Dashboard routes.
 *
 * Mounted at /api/dashboard. Auth + role gating come from the global pipeline in index.js.
 * Domain links:
 *  - specs/linen-inventory-shortage-tracking.md §4.1 (linen-shortage)
 *  - specs/ical-sync-override-locked-dates.md §4.3 (ical-date-drift)
 */

const router = require('express').Router();
const controller = require('../controllers/dashboardController');

router.get('/linen-shortage', controller.linenShortage);

router.get('/ical-date-drift', controller.icalDateDrift);
router.post('/ical-date-drift/:id/approve', controller.approveIcalDateDrift);
router.post('/ical-date-drift/:id/reject', controller.rejectIcalDateDrift);

router.get('/ical-cancellation', controller.icalCancellation);
router.post('/ical-cancellation/:id/approve', controller.approveIcalCancellation);
router.post('/ical-cancellation/:id/reject', controller.rejectIcalCancellation);

// specs/dashboard-ical-new-reservations.md — read-only card listing the day's iCal imports.
router.get('/ical-new-today', controller.icalNewReservationsToday);

module.exports = router;
