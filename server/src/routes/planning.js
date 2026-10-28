/**
 * Planning routes (specs/weekly-bed-linen-tracking.md).
 *
 * Mounted at /api/planning. Auth is enforced by the global requireAuth middleware in
 * `index.js`; role gating is handled by enforceRoleAccess (admin in practice — accountants
 * don't see Planning).
 */

const router = require('express').Router();
const controller = require('../controllers/planningController');

router.get('/today', controller.today);
router.get('/days', controller.days);
router.get('/breakfast', controller.breakfastSummary);
router.post('/option-cards/done', controller.setOptionCardDone);

module.exports = router;
