/**
 * Push routes (specs/pwa-push-notifications.md §4.3). Mounted under /api/push (auth-required via the
 * global requireAuth in index.js).
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/pushController');

router.get('/public-key', controller.getPublicKey);
router.post('/subscribe', controller.subscribe);
router.delete('/subscribe', controller.unsubscribe);
router.get('/preferences', controller.getPreferences);
router.put('/preferences', controller.updatePreferences);

module.exports = router;
