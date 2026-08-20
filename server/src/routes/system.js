/**
 * System routes — version probe and self-update control (specs/self-update-and-releases.md §4.3).
 *
 * Mounted at /api/system. Auth and role gating come from the global pipeline in index.js: every
 * path here is admin-only by construction, since `enforceRoleAccess` is deny-by-default for the
 * accountant and reception roles.
 */

const router = require('express').Router();
const controller = require('../controllers/systemController');

router.get('/version', controller.getVersion);
router.post('/version/check', controller.checkNow);

router.get('/update/status', controller.getUpdateStatus);
router.post('/update/start', controller.startUpdate);
router.post('/update/dismiss', controller.dismissUpdate);

module.exports = router;
