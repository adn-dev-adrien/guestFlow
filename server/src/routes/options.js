const router = require('express').Router();
const ctrl = require('../controllers/optionsController');
const optionDefaults = require('../controllers/propertyOptionDefaultsController');

router.get('/', ctrl.list);
router.get('/catalogue-view', ctrl.catalogueView);
router.get('/:id', ctrl.getOne);
// Per-property defaults — read-only mirror feeding OptionsPage (specs/weekly-bed-linen-tracking.md §3.7).
router.get('/:id/property-defaults', optionDefaults.listForOption);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.post('/:id/restore', ctrl.restore);

module.exports = router;
