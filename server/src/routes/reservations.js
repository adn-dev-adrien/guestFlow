const router = require('express').Router();
const controller = require('../controllers/reservationsController');
const refundsController = require('../controllers/refundsController');
const cancellationController = require('../controllers/reservationCancellationController');
const upcomingController = require('../controllers/upcomingReservationsController');
const installmentsController = require('../controllers/installmentsController');
const platformPenalties = require('../controllers/platformPenaltiesController');
const settlementsController = require('../controllers/paymentSettlementsController');
const { isReceptionOnly } = require('../constants/roles');
const db = require('../database');
const { guardReadOnly, guardNotDevis } = require('../utils/reservationReadOnly');
const { ficheVersionHeaders } = require('../middleware/ficheVersionHeaders');

// A duplicate set aside takes no write (specs/calendar-property-parity.md rule 22); a cancelled stay keeps the
// writes its history needs (refunds, the plan it was cancelled with).
const noWriteOnDuplicate = guardReadOnly(db, { cancelled: false });
const noWriteOnClosedStay = guardReadOnly(db, { cancelled: true });
// specs/reservations-backend-mvc.md rule 25 — a devis id is not a stay: its writes go through /devis/:id.
const notDevis = guardNotDevis(db);

// specs/reservations-backend-mvc.md rule 20 — a write on /reservations/undefined/… is a stay that does not exist.
const stayId = (req, res, next) => (/^[1-9]\d*$/.test(req.params.id) ? next() : res.status(404).json({ error: 'Réservation non trouvée' }));

// Reception sees no money (specs/reception-role-checkin-only.md): the plan is never theirs to change.
const notReception = (handler) => (req, res) => (isReceptionOnly(req.user)
  ? res.status(403).json({ error: 'FORBIDDEN' })
  : handler(req, res));

// Thin routes: wire HTTP verbs/paths to controller methods. All logic lives in the controller,
// model (DB), and utils (occupancy / audit / bed distribution).
// The open fiche follows its own writes (specs/reservation-fiche-concurrency.md rule 4).
router.use('/:id', ficheVersionHeaders());

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
router.post('/:id/refunds', stayId, noWriteOnDuplicate, refundsController.create);
router.delete('/:id/refunds/:refundId', refundsController.remove);
// Annulation d'un séjour (specs/payment-schedule-and-cancellation.md §3.5). Operator-confirmed only —
// nothing in GuestFlow cancels a stay on its own.
router.post('/:id/cancel', stayId, noWriteOnDuplicate, cancellationController.cancel);
// What the cancel would keep and write off, from the same figures (specs/payment-schedule-and-cancellation.md rule 60).
router.get('/:id/cancel-preview', stayId, noWriteOnDuplicate, cancellationController.preview);
// « Rétablir » a duplicate set aside (specs/calendar-property-parity.md rule 22). Admin-only through the role guard.
router.post('/:id/restore', stayId, controller.restoreSuperseded);
// Échéancier d'une réservation directe (specs/direct-installments.md §4.3).
router.put('/:id/installments', stayId, noWriteOnDuplicate, notReception(installmentsController.put));
router.delete('/:id/installments', stayId, notDevis, noWriteOnDuplicate, notReception(installmentsController.remove));
router.post('/:id/installments/:installmentId/payment', stayId, noWriteOnDuplicate, notReception(installmentsController.markPaid));

// Pénalités plateforme (specs/reconciliation-assisted-matching.md §4.3).
const send = (res, answer) => res.status(answer.status).json(answer.body);
router.get('/:id/platform-penalties', notReception((req, res) => send(res, platformPenalties.list(req.params.id))));
router.post('/:id/platform-penalties/preview', stayId, notDevis, notReception((req, res) => send(res, platformPenalties.preview(req.params.id, req.body))));
router.post('/:id/platform-penalties', stayId, notDevis, noWriteOnDuplicate, notReception((req, res) => send(res, platformPenalties.declare(req.params.id, req.body, req.user))));
router.delete('/:id/platform-penalties/:penaltyId', notDevis, noWriteOnDuplicate, notReception((req, res) => send(res, platformPenalties.remove(req.params.id, req.params.penaltyId))));
router.post('/calculate-price', controller.calculatePrice);
router.post('/', controller.create);
router.put('/:id', stayId, notDevis, controller.update);
router.patch('/:id/payment', stayId, notDevis, controller.updatePayment);
// specs/single-payment-from-the-fiche.md §4.3 — record (or undo) the single arrival payment
// without running the SAS: `{ mode: 'card' | 'cash' | 'undo', date }`.
router.post('/:id/arrival-payment', stayId, notDevis, noWriteOnClosedStay, controller.settleArrivalPayment);
// specs/mixed-method-payments.md §4.3 — collect the reste of a split payment, or correct one.
router.post('/:id/settlements', stayId, notDevis, noWriteOnClosedStay, notReception(settlementsController.collectRemainder));
router.put('/:id/settlements/:settlementId', stayId, notDevis, noWriteOnClosedStay, notReception(settlementsController.modify));
router.delete('/:id', stayId, controller.remove);

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
