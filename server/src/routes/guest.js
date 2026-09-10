// The guest tree (specs/guest-gate-access.md §4.1). Mounted at `/gate/v1`, and it EXISTS ONLY on
// the guest hostname — `guestTreeOnly` answers 404 anywhere else, including the admin host. It is
// mounted outside the `/api` session guard: there is no operator session here, and never will be.

const express = require('express');

const router = express.Router();
const { guestTreeOnly } = require('../middleware/requireGuestHost');
const { gateCodeLimiter, gateOpenLimiter } = require('../middleware/rateLimiters');
const controller = require('../controllers/guestGateController');

router.use(guestTreeOnly);

// The only route a stranger can reach without a code, hence the tightest limiter of the app.
router.post('/session', gateCodeLimiter, controller.openSession);
router.get('/session', controller.readSessionState);

router.post('/open', gateOpenLimiter, controller.requestOpen);
router.get('/open/:requestId', controller.readRequestStatus);

module.exports = router;
