// specs/plugins-phase-p-productisation.md §3.D — the start assistant. Admin-only through the role guard.
const router = require('express').Router();
const { buildController } = require('../controllers/onboardingController');

const controller = buildController({
  database: require('../database'),
  settingsModel: require('../models/settingsModel'),
  propertiesModel: require('../models/propertiesModel'),
  plugins: require('../controllers/pluginsController'),
  ensureVapid: (settings) => require('../utils/vapid').ensureVapid(settings),
});

router.get('/', controller.get);
router.put('/company', controller.saveCompany);
router.put('/property', controller.saveProperty);
router.put('/plugins', controller.savePlugins);
router.post('/done', controller.done);

module.exports = router;
