/**
 * Dashboard routes.
 *
 * Mounted at /api/dashboard. Auth + role gating come from the global pipeline in index.js.
 * Domain links:
 *  - specs/ical-sync-override-locked-dates.md §4.3 (ical-date-drift)
 */

const router = require('express').Router();
const controller = require('../controllers/dashboardController');
const db = require('../database');
const vatRegimeModel = require('../models/vatRegimeModel');
const { franchiseApplies } = require('../utils/vatFranchise');
const { guardReadOnly } = require('../utils/reservationReadOnly');

router.get('/ical-date-drift', controller.icalDateDrift);
router.post('/ical-date-drift/:id/approve', controller.approveIcalDateDrift);
router.post('/ical-date-drift/:id/reject', controller.rejectIcalDateDrift);

router.get('/ical-cancellation', controller.icalCancellation);
router.post('/ical-cancellation/:id/approve', controller.approveIcalCancellation);
router.post('/ical-cancellation/:id/reject', controller.rejectIcalCancellation);

// specs/dashboard-ical-new-reservations.md — read-only card listing the last 24 hours' reservations.
router.get('/new-reservations', controller.newReservations);

// specs/reservation-number-and-search.md rule 15 — stays numbered by the boot repair, until checked.
router.get('/repaired-reservation-numbers', controller.repairedReservationNumbers);
router.post('/repaired-reservation-numbers/:id/acknowledge', controller.acknowledgeRepairedReservationNumber);

// Échéances de paiement (specs/payment-schedule-and-cancellation.md §3.4). Admin-only: the reception
// allowlist is deny-by-default, so these three are already out of that role's reach.
router.get('/payment-deadlines', controller.paymentDeadlines);
// A duplicate set aside is never snoozed nor reminded; a cancelled stay is not reminded either
// (specs/calendar-property-parity.md rule 25).
router.post('/payment-deadlines/:id/snooze', guardReadOnly(db, { cancelled: false }), controller.snoozePaymentDeadline);
router.post('/payment-deadlines/:id/remind', guardReadOnly(db, { cancelled: true }), controller.remindPaymentDeadline);

// « À traiter » and the pinned cards of the home (specs/shell-and-home-day-first.md §3.B). Each core
// subject is read through the handler of its own card; the plugins add theirs with ctx.attention.
function coreAttentionSources() {
  const { ADMIN, userHasRole } = require('../constants/roles');
  const today = new Date();
  return [
    { key: 'payment-deadlines', rank: 20, handler: controller.paymentDeadlines },
    {
      key: 'vat-franchise',
      rank: 25,
      handler: require('../controllers/financeController').getVatFranchise,
      // Outside the franchise the subject does not exist: not even declared (specs/vat-optional-mode.md rule 44).
      skip: () => !franchiseApplies(vatRegimeModel.inForceBlock(db)),
    },
    { key: 'ical-date-drift', rank: 10, handler: controller.icalDateDrift },
    { key: 'ical-cancellation', rank: 20, handler: controller.icalCancellation },
    {
      key: 'cancellation-compensations',
      rank: 30,
      handler: require('../controllers/cancellationCompensationsController').list,
      // The pending list is global; the endpoint only needs a month for the received ones.
      query: () => ({ month: String(today.getMonth() + 1), year: String(today.getFullYear()) }),
    },
    { key: 'repaired-reservation-numbers', rank: 40, handler: controller.repairedReservationNumbers },
    { key: 'email-readiness', rank: 80, handler: require('./emailReadiness').controller.get },
    { key: 'new-reservations', rank: 10, handler: controller.newReservations },
    { key: 'email-pending', rank: 30, handler: require('./emails').controller.pending },
    { key: 'update-available', rank: 40, handler: require('../controllers/systemController').getVersion },
    {
      key: 'plugins-switched-off',
      rank: 45,
      handler: require('../controllers/pluginsAttentionController').handler(require('../models/pluginsModel'), require('../utils/pluginGovernance').isOperatorManaged),
      // Whoever cannot switch a plugin on has nothing to do with this line.
      skip: (req) => !userHasRole(req.user, ADMIN),
    },
    {
      key: 'two-factor',
      rank: 50,
      handler: require('../controllers/authController').twoFactorStatus,
      // A support session never sees the nudge (specs/hosting-h2-account-security.md rule 10).
      skip: (req) => Boolean(req.session && req.session.user && req.session.user.isSupport),
    },
  ];
}
const attention = require('../controllers/dashboardAttentionController').buildController({ coreSources: coreAttentionSources });
router.get('/attention', attention.attention);

module.exports = router;
// Every core key must have a server summary and a client component (dashboard-attention-routes test).
module.exports.coreAttentionSources = coreAttentionSources;
