/**
 * Platforms routes — read-only list of platform names for the UI dropdowns.
 * specs/ical-platforms-in-dropdowns.md.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/platformsController');

router.get('/', controller.listNames);
// specs/platform-price-from-commission.md — non-direct platforms + their commission %, and the
// per-platform commission % editor used by the property tarif page.
router.get('/with-commission', controller.listWithCommission);
router.put('/:id/commission', controller.setCommission);

module.exports = router;
