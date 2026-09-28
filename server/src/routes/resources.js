const router = require('express').Router();
const controller = require('../controllers/resourcesController');
const requirePlugin = require('../middleware/requirePlugin');
const PLUGINS = require('../constants/plugins');

router.get('/', controller.list);
router.get('/availability', controller.availability);
router.get('/baby-bed-availability', controller.babyBedAvailability);
router.get('/:id/delete-impact', controller.getDeleteImpact);
router.get('/:id/free-slots', requirePlugin(PLUGINS.HOURLY_RESOURCES), controller.freeSlots);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
