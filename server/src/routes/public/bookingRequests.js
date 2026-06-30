const express = require('express');

const router = express.Router();
const { bookingRequestLimiter } = require('../../middleware/rateLimiters');
const ctrl = require('../../controllers/public/publicBookingRequestController');
const payCtrl = require('../../controllers/public/publicPaymentController');

router.post('/', bookingRequestLimiter, ctrl.create);
// Online full-payment for a public devis (specs/public-online-payment.md §3).
router.post('/:id/pay', bookingRequestLimiter, payCtrl.pay);
router.get('/:id/status', payCtrl.status);

module.exports = router;
