/**
 * Dashboard routes.
 *
 * Mounted at /api/dashboard. Auth + role gating come from the global pipeline in index.js.
 * Domain links:
 *  - specs/ical-sync-override-locked-dates.md §4.3 (ical-date-drift)
 */

const router = require('express').Router();
const controller = require('../controllers/dashboardController');

router.get('/ical-date-drift', controller.icalDateDrift);
router.post('/ical-date-drift/:id/approve', controller.approveIcalDateDrift);
router.post('/ical-date-drift/:id/reject', controller.rejectIcalDateDrift);

router.get('/ical-cancellation', controller.icalCancellation);
router.post('/ical-cancellation/:id/approve', controller.approveIcalCancellation);
router.post('/ical-cancellation/:id/reject', controller.rejectIcalCancellation);

// specs/dashboard-ical-new-reservations.md — read-only card listing the last 24 hours' reservations.
router.get('/new-reservations', controller.newReservations);

// Échéances de paiement (specs/payment-schedule-and-cancellation.md §3.4). Admin-only: the reception
// allowlist is deny-by-default, so these three are already out of that role's reach.
router.get('/payment-deadlines', controller.paymentDeadlines);
router.post('/payment-deadlines/:id/snooze', controller.snoozePaymentDeadline);
router.post('/payment-deadlines/:id/remind', controller.remindPaymentDeadline);

module.exports = router;
