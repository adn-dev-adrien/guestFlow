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

// specs/site-booking-notifications.md — pending site-origin devis (booking requests from the website).
// Échéances de paiement (specs/payment-schedule-and-cancellation.md §3.4). Admin-only: the reception
// allowlist is deny-by-default, so these three are already out of that role's reach.
router.get('/payment-deadlines', controller.paymentDeadlines);
router.post('/payment-deadlines/:id/snooze', controller.snoozePaymentDeadline);
router.post('/payment-deadlines/:id/remind', controller.remindPaymentDeadline);

router.get('/public-devis-pending', controller.publicDevisPending);

module.exports = router;
