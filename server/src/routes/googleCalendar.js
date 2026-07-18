const router = require('express').Router();
const ctrl = require('../controllers/googleCalendarController');

router.get('/status', ctrl.status);
router.get('/oauth/authorize', ctrl.oauthAuthorize);
router.get('/oauth/callback', ctrl.oauthCallback);
router.post('/oauth/disconnect', ctrl.oauthDisconnect);
router.get('/calendars', ctrl.listCalendars);
router.put('/calendar', ctrl.setCalendar);
router.post('/test-connection', ctrl.testConnection);
router.post('/sync-now', ctrl.syncNow);

module.exports = router;
