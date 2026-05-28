const router = require('express').Router();
const controller = require('../controllers/devisController');

router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.patch('/:id/status', controller.updateStatus);
router.get('/:id/history', controller.history);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);
router.post('/:id/convert-to-reservation', controller.convertToReservation);
router.post('/from-reservation/:reservationId', controller.convertFromReservation);
router.get('/:id/pdf', controller.pdf);

module.exports = router;
