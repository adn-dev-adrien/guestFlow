/**
 * Public API router (specs/public-api.md). Mounted at `/public/v1`, on a SEPARATE tree from the
 * internal `/api/*` admin API — it never passes through the session guard. The whole tree is
 * protected by the dedicated API key + the broad public rate limiter; the booking-request route
 * adds its own stricter limiter.
 */

const express = require('express');

const router = express.Router();
const requirePublicApiKey = require('../../middleware/requirePublicApiKey');
const { publicApiLimiter } = require('../../middleware/rateLimiters');
const visitorContext = require('../../middleware/visitorContext');

// Key first, then the visitor the proxy relays, then the limiter that counts per visitor
// (specs/terms-acceptance-record.md rule 24): the relayed address is only honoured once the caller is
// known to be the proxy, and an unauthenticated call is refused before it is counted.
router.use(requirePublicApiKey);
router.use(visitorContext);
router.use(publicApiLimiter);

router.use('/', require('./properties'));
router.use('/terms', require('./terms'));
router.use('/quote', require('./quote'));
router.use('/booking-requests', require('./bookingRequests'));
router.use('/', require('./pluginUpdate'));

module.exports = router;
