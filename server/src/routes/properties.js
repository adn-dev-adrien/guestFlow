const router = require('express').Router();
const ctrl = require('../controllers/propertiesController');
const ical = require('../controllers/propertyIcalController');
const { handlePhotoUpload, handleDocumentUpload, multerErrorHandler } = require('../utils/propertyUploads');

// Properties
router.get('/', ctrl.list);
router.get('/platform-colors', ctrl.platformColors);
router.get('/:id', ctrl.getOne);
router.post('/:id/pricing/progressive-preview', ctrl.progressivePreview);
router.post('/', handlePhotoUpload, ctrl.create);
router.put('/:id', handlePhotoUpload, ctrl.update);
router.delete('/:id', ctrl.remove);

// Pricing rules
router.post('/:id/pricing', ctrl.addPricing);
router.put('/:id/pricing/:ruleId', ctrl.updatePricing);
router.delete('/:id/pricing/:ruleId', ctrl.deletePricing);
router.post('/:id/pricing/apply-to', ctrl.applyPricing);

// Documents
router.post('/:id/documents', handleDocumentUpload, ctrl.addDocument);
router.delete('/:id/documents/:docId', ctrl.deleteDocument);

// Property ↔ options linkage
router.put('/:id/options', ctrl.setOptions);

// iCal sources
router.get('/:id/ical-sources', ical.listSources);
router.post('/:id/ical-sources', ical.createSource);
router.put('/:id/ical-sources/:sourceId', ical.updateSource);
router.delete('/:id/ical-sources/:sourceId', ical.removeSource);
router.post('/:id/ical-sources/:sourceId/sync', ical.sync);
router.post('/:id/ical-sources/sync-all', ical.syncAll);

router.use(multerErrorHandler);

module.exports = router;
