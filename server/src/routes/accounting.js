/**
 * Accounting routes — read-only, accessible to admin AND accountant (the role guard in
 * middleware/enforceRoleAccess allows GETs here for accountant; everything else is admin-only).
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/accountingController');
const platformAccountsController = require('../controllers/platformAccountsController');

router.get('/sales.csv', controller.salesCsv);
router.get('/sales', controller.salesJson);
router.get('/platforms', controller.platformsPreview);

// accounting-platform-commission-and-no-deposit.md §3.7 + §4.3. Dedicated page
// `/comptabilite/plateformes` accessible to admin + accountant; PUT is whitelisted on the
// accountant role guard in middleware/enforceRoleAccess.js.
router.get('/platform-accounts', platformAccountsController.getAll);
router.put('/platform-accounts', platformAccountsController.saveAll);
// Operator-triggered rescan: re-runs the union INSERT OR IGNORE from `ical_sources` +
// `reservations.platform` so a brand-new platform name surfaces without a server restart.
router.post('/platform-accounts/refresh', platformAccountsController.refresh);

module.exports = router;
