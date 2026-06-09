const express = require('express');

const router = express.Router();
const ctrl = require('../../controllers/public/publicCatalogController');

router.get('/properties', ctrl.listProperties);
router.get('/properties/:id', ctrl.getProperty);
router.get('/properties/:id/options', ctrl.listOptions);
router.get('/properties/:id/resources', ctrl.listResources);
router.get('/properties/:id/availability', ctrl.getAvailability);

module.exports = router;
