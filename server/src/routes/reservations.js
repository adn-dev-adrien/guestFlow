const router = require('express').Router();
const controller = require('../controllers/reservationsController');
const refundsController = require('../controllers/refundsController');
const cancellationController = require('../controllers/reservationCancellationController');
const upcomingController = require('../controllers/upcomingReservationsController');
const installmentsController = require('../controllers/installmentsController');
const { isReceptionOnly } = require('../constants/roles');
const db = require('../database');
const { guardReadOnly } = require('../utils/reservationReadOnly');

// A duplicate set aside takes no write (specs/calendar-property-parity.md rule 22); a cancelled stay keeps the
// writes its history needs (refunds, the plan it was cancelled with).
const noWriteOnDuplicate = guardReadOnly(db, { cancelled: false });
const noWriteOnClosedStay = guardReadOnly(db, { cancelled: true });

// Reception sees no money (specs/reception-role-checkin-only.md): the plan is never theirs to change.
const notReception = (handler) => (req, res) => (isReceptionOnly(req.user)
  ? res.status(403).json({ error: 'FORBIDDEN' })
  : handler(req, res));

// Thin routes: wire HTTP verbs/paths to controller methods. All logic lives in the controller,
// model (DB), and utils (occupancy / audit / bed distribution).
router.post('/suggest-beds', controller.suggestBeds);
router.post('/platform-commission', controller.platformCommission);
// « Nouvelle note » total (specs/mid-stay-notes.md rule 22) — before '/:id'.
router.post('/mid-stay-note/preview', controller.previewMidStayNote);
router.get('/', controller.list);
// MUST stay before '/:id' — otherwise Express matches `:id = 'search'`.
router.get('/search', controller.search);
// « Réservations à venir » in one call (specs/upcoming-reservations-cards.md rule 6) — also before '/:id'.
router.get('/upcoming', upcomingController.upcoming);
router.get('/occupied-dates/:propertyId', controller.occupiedDates);
router.get('/:id', controller.getById);
router.get('/:id/history', controller.getHistory);
// Remboursements (specs/reservation-refunds.md §4.3). Admin-only through the standard role guard;
// deliberately reachable on a past-locked reservation — an early departure is discovered after the stay.
router.get('/:id/refunds', refundsController.list);
router.post('/:id/refunds', noWriteOnDuplicate, refundsController.create);
router.delete('/:id/refunds/:refundId', refundsController.remove);
// Annulation d'un séjour (specs/payment-schedule-and-cancellation.md §3.5). Operator-confirmed only —
// nothing in GuestFlow cancels a stay on its own.
router.post('/:id/cancel', noWriteOnDuplicate, cancellationController.cancel);
// The SAS belongs to a plugin, mounted after these core routes: the guard answers first, and lets a live stay
// through to the plugin's handler.
router.post(
  ['/:id/sas/arrival', '/:id/sas/departure', '/:id/sas/arrival/preview', '/:id/sas/departure/preview'],
  noWriteOnClosedStay,
);
// « Rétablir » a duplicate set aside (specs/calendar-property-parity.md rule 22). Admin-only through the role guard.
router.post('/:id/restore', controller.restoreSuperseded);
// Échéancier d'une réservation directe (specs/direct-installments.md §4.3).
router.put('/:id/installments', noWriteOnDuplicate, notReception(installmentsController.put));
router.delete('/:id/installments', noWriteOnDuplicate, notReception(installmentsController.remove));
router.post('/:id/installments/:installmentId/payment', noWriteOnDuplicate, notReception(installmentsController.markPaid));
router.post('/calculate-price', controller.calculatePrice);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.patch('/:id/payment', controller.updatePayment);
// specs/single-payment-from-the-fiche.md §4.3 — record (or undo) the single arrival payment
// without running the SAS: `{ mode: 'card' | 'cash' | 'undo', date }`.
router.post('/:id/arrival-payment', noWriteOnClosedStay, controller.settleArrivalPayment);
router.delete('/:id', controller.remove);

module.exports = router;

// Backward-compatible test surface (helpers now live in utils; re-exported so existing tests pass).
const { buildOccupiedDatesFromReservations, getNightBlocksFromTimes } = require('../utils/occupancy');
const { computeNextIcalSyncLocked, inferCustomAccommodationPrice } = require('../utils/reservationHelpers');
const { suggestBedDistribution } = require('../utils/bedDistribution');
module.exports.__test = {
  buildOccupiedDatesFromReservations,
  computeNextIcalSyncLocked,
  inferCustomAccommodationPrice,
  getNightBlocksFromTimes,
  suggestBedDistribution,
};
