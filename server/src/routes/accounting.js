/**
 * Accounting routes — read-only, accessible to admin AND accountant (the role guard in
 * middleware/enforceRoleAccess allows GETs here for accountant; everything else is admin-only).
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/accountingController');

router.get('/sales.csv', controller.salesCsv);
router.get('/sales', controller.salesJson);
router.get('/platforms', controller.platformsPreview);

module.exports = router;
