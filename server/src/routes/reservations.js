const router = require('express').Router();
const controller = require('../controllers/reservationsController');
const sasController = require('../controllers/sasController');

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
