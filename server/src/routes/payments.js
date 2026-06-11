/**
 * Payments routes (specs/online-payments-qonto.md §4.3). Thin — delegates to paymentsController.
 * Mounted at /api/payments behind the standard session guard (see index.js).
 */

const express = require('express');

const router = express.Router();
const ctrl = require('../controllers/paymentsController');

// Qonto OAuth connect flow.
router.get('/qonto/authorize', ctrl.qontoAuthorize);
router.get('/qonto/callback', ctrl.qontoCallback);
router.get('/qonto/status', ctrl.qontoStatus);

module.exports = router;
