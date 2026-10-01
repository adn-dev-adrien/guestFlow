/**
 * Cancellation compensations (specs/cancellation-compensation.md §4.3) — core: the dashboard alert and
 * the « Indemnités d'annulation » page settle them without the accounting export. The export's own
 * routes under /api/accounting (journal, CSV, account plan) belong to the `accounting-export` plugin
 * (specs/plugins-phase-2-hosts.md rule 19).
 *
 * The accountant reads the list (middleware/enforceRoleAccess); every write is admin-only.
 */

const express = require('express');
const router = express.Router();
const compensationsController = require('../controllers/cancellationCompensationsController');

router.get('/cancellation-compensations', compensationsController.list);
router.post('/cancellation-compensations', compensationsController.create);
router.put('/cancellation-compensations/:id', compensationsController.update);
router.post('/cancellation-compensations/:id/receive', compensationsController.receive);
router.post('/cancellation-compensations/:id/reopen', compensationsController.reopen);
router.delete('/cancellation-compensations/:id', compensationsController.remove);

module.exports = router;
