const router = require('express').Router();
const controller = require('../controllers/resourcesController');

router.get('/', controller.list);
router.get('/availability', controller.availability);
router.get('/baby-bed-availability', controller.babyBedAvailability);
router.get('/:id/delete-impact', controller.getDeleteImpact);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
