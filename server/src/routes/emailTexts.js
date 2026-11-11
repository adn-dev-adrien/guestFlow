// specs/guest-email-texts-made-simple.md §4.1 — « Textes des emails ». Admin-only through the role guard.
const express = require('express');
const { buildController } = require('../controllers/emailTextsController');

const router = express.Router();
const controller = buildController({ database: require('../database') });

router.get('/', controller.list);
router.put('/', controller.save);
router.post('/confirm', controller.confirm);
router.get('/export', controller.exportCsv);
router.post('/import', express.text({ type: ['text/csv', 'text/plain'], limit: '4mb' }), controller.importCsv);
router.post('/translate', controller.translate);

module.exports = router;
