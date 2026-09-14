// `/internal/portier/v1/events` — the one request Portier sends to guestFlow
// (specs/gate-access-portier.md §3.6, Portier `specs/contract.md` §4).
//
// Mounted outside `/api`: no session guard applies, and none should. Its guards are in the controller —
// the loopback socket (403 otherwise) and the signature (401 otherwise). The edge proxy never forwards
// `/internal/`.

const router = require('express').Router();
const controller = require('../controllers/portierController');

router.post('/v1/events', controller.receiveEvent);

module.exports = router;
