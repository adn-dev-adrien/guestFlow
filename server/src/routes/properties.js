const router = require('express').Router();
const ctrl = require('../controllers/propertiesController');
const ical = require('../controllers/propertyIcalController');
const optionDefaults = require('../controllers/propertyOptionDefaultsController');
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
router.post('/:id/pricing/assign-dates', ctrl.assignPricingDateRange);
router.get('/:id/platform-prices', ctrl.platformPrices);

// Tariff recipe preview/apply for a property (specs/tariff-recipes/spec.md §3.2).
const tariffRecipes = require('../controllers/tariffRecipesController');
router.get('/:id/tariff-recipe/preview', tariffRecipes.previewForProperty);
router.post('/:id/tariff-recipe/apply', tariffRecipes.applyToProperty);
router.post('/:id/tariff-recipe/detach', tariffRecipes.detachFromProperty);

// Documents
router.post('/:id/documents', handleDocumentUpload, ctrl.addDocument);
router.delete('/:id/documents/:docId', ctrl.deleteDocument);

// Property ↔ options linkage
router.put('/:id/options', ctrl.setOptions);

// Per-property option DEFAULTS (specs/weekly-bed-linen-tracking.md §3.7).
router.get('/:id/option-defaults', optionDefaults.listForProperty);
router.put('/:id/option-defaults/:optionId', optionDefaults.setForProperty);
router.delete('/:id/option-defaults/:optionId', optionDefaults.unsetForProperty);

// Merged platform list for a property (specs/platforms-and-ical-rework.md §4.3): every platform +
// this property's iCal-source config + the global colour.
router.get('/:id/platforms', ical.listPlatforms);

// iCal sources
router.get('/:id/ical-sources', ical.listSources);
router.post('/:id/ical-sources', ical.createSource);
router.put('/:id/ical-sources/:sourceId', ical.updateSource);
router.delete('/:id/ical-sources/:sourceId', ical.removeSource);
router.post('/:id/ical-sources/:sourceId/sync', ical.sync);
router.post('/:id/ical-sources/sync-all', ical.syncAll);

router.use(multerErrorHandler);

module.exports = router;
