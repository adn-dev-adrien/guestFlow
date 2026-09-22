// CGV administration (specs/terms-acceptance-record.md §4.4). Admin-only through the deny-by-default
// role guard of index.js.
const router = require('express').Router();

const termsController = require('../controllers/termsController');

router.get('/', termsController.getOverview);
router.put('/draft', termsController.saveDraft);
router.post('/preview', termsController.preview);
router.post('/publish', termsController.publish);
router.put('/enforcement', termsController.updateEnforcement);
router.get('/versions/:version', termsController.getVersion);

module.exports = router;
