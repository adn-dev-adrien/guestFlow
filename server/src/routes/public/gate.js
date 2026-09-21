/**
 * The gate-access connector tree, mounted on `/public/v1/gate`
 * (specs/gate-access-sowel-connector.md §4).
 *
 * Deliberately **beside** `/public/v1` rather than inside it: the rest of the public tree is
 * authenticated by `PUBLIC_API_KEY`, the WordPress proxy's key. The site's key has no business
 * reading who sleeps here tonight, nor writing a gate code — hence a distinct key, and a signature
 * on top of it.
 */

const express = require('express');
const requireGateConnector = require('../../middleware/requireGateConnector');
const { publicApiLimiter } = require('../../middleware/rateLimiters');
const controller = require('../../controllers/gateConnectorController');

const router = express.Router();

router.use(publicApiLimiter);
router.use(requireGateConnector);

router.get('/ping', controller.ping);
router.get('/stays', controller.stays);
router.post('/invitations', controller.receiveInvitations);

module.exports = router;
