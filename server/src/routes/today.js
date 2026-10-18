/**
 * Mounted at /api/today. Any signed-in role may read it: it is a self endpoint
 * (middleware/enforceRoleAccess.js SELF_ENDPOINTS).
 */

const router = require('express').Router();
const controller = require('../controllers/todayController');

router.get('/', controller.getToday);

module.exports = router;
