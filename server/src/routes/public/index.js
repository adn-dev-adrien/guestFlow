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

router.use(publicApiLimiter);
router.use(requirePublicApiKey);

router.use('/', require('./properties'));
router.use('/quote', require('./quote'));
router.use('/booking-requests', require('./bookingRequests'));

module.exports = router;
