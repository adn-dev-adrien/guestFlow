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
// specs/platforms-and-ical-rework.md §3 rules 5-6 — set a platform's GLOBAL calendar colour.
// `:key` is the platform label/name (url-encoded); recolours that platform's reservations everywhere.
router.put('/:key/color', controller.setColor);
// specs/per-platform-tourist-tax-three-way.md — set a platform's GLOBAL tourist-tax mode (applies to
// every property at once). `:key` is the platform label/name (url-encoded).
router.put('/:key/tourist-tax', controller.setTouristTax);

module.exports = router;
