const router = require('express').Router();
const controller = require('../controllers/resourceBookingsController');

// Specific routes before /:id to avoid conflicts.
router.get('/planning-events', controller.planningEvents);
router.get('/occupied-slots', controller.occupiedSlots);
router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
