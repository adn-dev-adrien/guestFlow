const router = require('express').Router();
const ctrl = require('../controllers/calendarNotesController');

router.get('/:propertyId', ctrl.list);
router.put('/:propertyId/:date', ctrl.upsert);
router.delete('/:propertyId/:date', ctrl.remove);

module.exports = router;
