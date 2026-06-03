/**
 * Dashboard routes (specs/linen-inventory-shortage-tracking.md §4.1).
 *
 * Mounted at /api/dashboard. Auth + role gating come from the global pipeline in index.js.
 */

const router = require('express').Router();
const controller = require('../controllers/dashboardController');

router.get('/linen-shortage', controller.linenShortage);

module.exports = router;
