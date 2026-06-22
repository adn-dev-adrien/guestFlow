/**
 * Payment-methods routes — CRUD over the direct-reservation payment-method catalogue.
 * Thin: delegates to paymentMethodsController. specs/direct-payment-method-commission.md §4.3.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/paymentMethodsController');

router.get('/', controller.list);                 // ?all=1 to include inactive
router.post('/', controller.create);
router.put('/:id', controller.update);
router.put('/:id/default', controller.setDefault);
router.put('/:id/active', controller.setActive);
router.delete('/:id', controller.remove);          // deactivates if referenced, hard-deletes otherwise

module.exports = router;
