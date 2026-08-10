const router = require('express').Router();
const controller = require('../controllers/reservationsController');
const sasController = require('../controllers/sasController');
const weatherController = require('../controllers/weatherController');
const refundsController = require('../controllers/refundsController');

// Thin routes: wire HTTP verbs/paths to controller methods. All logic lives in the controller,
// model (DB), and utils (occupancy / audit / bed distribution).
router.post('/suggest-beds', controller.suggestBeds);
router.get('/', controller.list);
// MUST stay before '/:id' — otherwise Express matches `:id = 'search'`.
router.get('/search', controller.search);
router.get('/occupied-dates/:propertyId', controller.occupiedDates);
router.get('/:id', controller.getById);
router.get('/:id/history', controller.getHistory);
// Arrival / departure SAS (specs/arrival-departure-sas.md)
router.get('/:id/sas', sasController.getSas);
router.post('/:id/sas/arrival', sasController.commitArrival);
router.post('/:id/sas/departure', sasController.commitDeparture);
// Weather-alert page for the arrival SAS (specs/checkin-weather-alerts.md). Fired in the background
// when the check-in opens; never blocks the wizard, degrades to an empty list on any failure.
router.get('/:id/weather-alerts', weatherController.getReservationAlerts);
// Remboursements (specs/reservation-refunds.md §4.3). Admin-only through the standard role guard;
// deliberately reachable on a past-locked reservation — an early departure is discovered after the stay.
router.get('/:id/refunds', refundsController.list);
router.post('/:id/refunds', refundsController.create);
router.delete('/:id/refunds/:refundId', refundsController.remove);
router.post('/calculate-price', controller.calculatePrice);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.patch('/:id/payment', controller.updatePayment);
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
