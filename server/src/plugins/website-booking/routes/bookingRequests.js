const express = require('express');
const sdk = require('../../sdk');

const router = express.Router();
const { bookingRequestLimiter, paymentStatusLimiter } = sdk.coreModule('rateLimiters');
const ctrl = require('../controllers/publicBookingRequestController');
const { closedWhenReadOnly } = sdk.coreModule('enforceSubscription');

// Online payment for a public devis (specs/public-online-payment.md §3) is the core's provider-neutral
// money path: it answers while a payment provider plugin is live (specs/plugins-phase-3a-online-payment.md
// rule 5). Both routes require the per-devis capability token (§7); /status is throttled tighter than
// the broad public limiter.
const payCtrl = sdk.coreModule('publicPaymentController');
const requireOnlinePayment = payCtrl.requireProvider;

router.post('/', bookingRequestLimiter, closedWhenReadOnly(), ctrl.create);
router.post('/:id/pay', bookingRequestLimiter, requireOnlinePayment, payCtrl.pay);
router.get('/:id/status', paymentStatusLimiter, requireOnlinePayment, payCtrl.status);

module.exports = router;
