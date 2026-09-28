/**
 * Planning routes (specs/weekly-bed-linen-tracking.md).
 *
 * Mounted at /api/planning. Auth is enforced by the global requireAuth middleware in
 * `index.js`; role gating is handled by enforceRoleAccess (admin in practice — accountants
 * don't see Planning).
 */

const router = require('express').Router();
const controller = require('../controllers/planningController');
const requirePlugin = require('../middleware/requirePlugin');
const PLUGINS = require('../constants/plugins');

router.get('/laundry', requirePlugin(PLUGINS.LINEN), controller.laundrySummary);
router.get('/linen-inventory', requirePlugin(PLUGINS.LINEN), controller.linenInventory);
router.get('/breakfast', controller.breakfastSummary);
router.get('/option-cards', controller.optionCards);
router.post('/option-cards/done', controller.setOptionCardDone);
router.get('/resource-cards', requirePlugin(PLUGINS.HOURLY_RESOURCES), controller.resourceCards);
router.post('/resource-cards/done', requirePlugin(PLUGINS.HOURLY_RESOURCES), controller.setResourceCardDone);

module.exports = router;
