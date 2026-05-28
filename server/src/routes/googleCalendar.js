const router = require('express').Router();
const ctrl = require('../controllers/googleCalendarController');

router.get('/status', ctrl.status);
router.post('/test-connection', ctrl.testConnection);
router.post('/sync-reservations', ctrl.syncReservations);

module.exports = router;
