const express = require('express');
const sdk = require('../../sdk');

const router = express.Router();
const { bookingRequestLimiter, paymentStatusLimiter } = sdk.coreModule('rateLimiters');
const ctrl = require('../controllers/publicBookingRequestController');
const { closedWhenReadOnly } = sdk.coreModule('enforceSubscription');

// Online full-payment for a public devis (specs/public-online-payment.md §3) stays a core handler of
// online-payment until phase 3 (specs/plugins-phase-2-hosts.md rule 23): it needs both plugins. Both
// routes require the per-devis capability token (§7); /status is throttled tighter than the broad
// public limiter.
const payCtrl = sdk.coreModule('publicPaymentController');
const requireOnlinePayment = sdk.coreModule('requirePlugin')('online-payment');

router.post('/', bookingRequestLimiter, closedWhenReadOnly(), ctrl.create);
router.post('/:id/pay', bookingRequestLimiter, requireOnlinePayment, payCtrl.pay);
router.get('/:id/status', paymentStatusLimiter, requireOnlinePayment, payCtrl.status);

module.exports = router;
