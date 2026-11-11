const router = require('express').Router();
const controller = require('../controllers/devisController');
const { ficheVersionHeaders } = require('../middleware/ficheVersionHeaders');

router.get('/', controller.list);
router.use('/:id', ficheVersionHeaders());
router.get('/:id', controller.getOne);
router.patch('/:id/status', controller.updateStatus);
router.get('/:id/history', controller.history);
router.get('/:id/extension', controller.extensionPreview);
router.post('/:id/extend', controller.extend);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);
router.post('/:id/convert-to-reservation', controller.convertToReservation);
router.post('/from-reservation/:reservationId', controller.convertFromReservation);
router.get('/:id/pdf', controller.pdf);

module.exports = router;
