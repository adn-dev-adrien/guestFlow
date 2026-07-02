const express = require('express');

const router = express.Router();
const { bookingRequestLimiter, paymentStatusLimiter } = require('../../middleware/rateLimiters');
const ctrl = require('../../controllers/public/publicBookingRequestController');
const payCtrl = require('../../controllers/public/publicPaymentController');

router.post('/', bookingRequestLimiter, ctrl.create);
// Online full-payment for a public devis (specs/public-online-payment.md §3). Both routes require the
// per-devis capability token (§7); /status is throttled tighter than the broad public limiter.
router.post('/:id/pay', bookingRequestLimiter, payCtrl.pay);
router.get('/:id/status', paymentStatusLimiter, payCtrl.status);

module.exports = router;
