const express = require('express');

const router = express.Router();
const ctrl = require('../controllers/publicCatalogController');

// Mounted at /public/v1/properties.
router.get('/', ctrl.listProperties);
router.get('/:id', ctrl.getProperty);
router.get('/:id/options', ctrl.listOptions);
router.get('/:id/resources', ctrl.listResources);
router.get('/:id/availability', ctrl.getAvailability);

module.exports = router;
