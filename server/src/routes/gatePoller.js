// The Sowel-facing routes (specs/guest-gate-access.md §4.3). Mounted under `/public/v1/gate`, on
// the same tree as the WordPress public API — but behind its OWN key: `requireGateApiKey` replaces
// the public one for these two paths, so the site's key cannot drain the gate queue and the house's
// key cannot read the booking API.

const express = require('express');

const router = express.Router();
const requireGateApiKey = require('../middleware/requireGateApiKey');
const controller = require('../controllers/gatePollerController');

router.use(requireGateApiKey);

router.get('/requests', controller.pollRequests);
router.post('/requests/:id/result', controller.reportResult);

module.exports = router;
