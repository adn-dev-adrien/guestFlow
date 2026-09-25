/**
 * Translation catalogue routes (specs/translation-catalogue.md §4.3). Thin — delegates to
 * translationsController. Mounted at /api/translations behind the standard session guard.
 *
 * The import takes the CSV as a raw text body rather than a multipart upload: it is one text file,
 * the browser already has it as a string, and nothing then has to be written to disk and cleaned up.
 */

const express = require('express');

const router = express.Router();
const ctrl = require('../controllers/translationsController');

router.get('/summary', ctrl.getSummary);
router.get('/export', ctrl.exportCsv);
router.post('/import', express.text({ type: ['text/csv', 'text/plain'], limit: '4mb' }), ctrl.importCsv);

module.exports = router;
