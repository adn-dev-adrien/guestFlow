const router = require('express').Router();
const ctrl = require('../controllers/icalController');

router.get('/token/:propertyId', ctrl.token);
router.get('/export/:token', ctrl.exportIcal);
router.post('/regenerate-token/:propertyId', ctrl.regenerate);

module.exports = router;
