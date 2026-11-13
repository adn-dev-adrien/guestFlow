/**
 * Standalone sales (specs/pricing-components.md rule 53) — the « Vente hors séjour » counter. Core: no plugin is needed.
 * Admin-only by the role guard (an accountant or a reception user reaches neither route).
 */
const express = require('express');
const controller = require('../controllers/standaloneSalesController');

const router = express.Router();

router.get('/vat-rates', controller.vatRates);
router.get('/', controller.list);
router.post('/quote', controller.quote);
router.post('/', controller.sell);
router.post('/:id/payment-link', controller.mintLink);
router.delete('/:id/payment-link/:linkId', controller.withdrawLink);
router.post('/:id/payment-link/:linkId/email', controller.emailLink);

module.exports = router;
