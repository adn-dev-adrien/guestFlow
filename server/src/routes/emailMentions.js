// specs/plugins-phase-p-productisation.md §4.3 — « Options citées ». Admin-only through the role guard.
const router = require('express').Router();
const { buildController } = require('../controllers/emailMentionsController');

const controller = buildController({ database: require('../database') });

router.get('/', controller.list);
router.post('/', controller.create);
// Static paths before `/:id`.
router.put('/order', controller.reorder);
router.put('/confirmation-order', controller.setConfirmationOrder);
router.post('/preview', controller.preview);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
