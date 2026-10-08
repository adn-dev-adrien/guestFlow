// specs/plugins-phase-p-productisation.md §4.3 — « Textes des mails ». Admin-only through the role guard.
const router = require('express').Router();
const { buildController } = require('../controllers/stayTextsController');

const controller = buildController({ database: require('../database') });

router.get('/', controller.list);
router.put('/:key', controller.save);
router.delete('/:key', controller.reset);

module.exports = router;
