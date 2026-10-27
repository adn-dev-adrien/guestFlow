const express = require('express');
const sdk = require('../../sdk');

const router = express.Router();
const { bookingRequestLimiter, paymentStartLimiter, paymentStatusLimiter } = sdk.coreModule('rateLimiters');
const ctrl = require('../controllers/publicBookingRequestController');
const proof = require('../controllers/publicChallengeController');
const { closedWhenReadOnly } = sdk.coreModule('enforceSubscription');

// Online payment for a public devis (specs/public-online-payment.md §3) is the core's provider-neutral
// money path: it answers while a payment provider plugin is live (specs/plugins-phase-3a-online-payment.md
// rule 5). Both routes require the per-devis capability token (§7); /pay has its own budget so retrying
// a payment never spends the booking-request one, and /status is throttled tighter than the broad
// public limiter.
const payCtrl = sdk.coreModule('publicPaymentController');
const requireOnlinePayment = payCtrl.requireProvider;

// The proof of work (specs/public-request-abuse-and-grouping.md rules 1-5b): the drawer fetches a
// challenge as it opens; the request spends it, checked before anything else is read.
router.get('/challenge', proof.issueChallenge);
router.post('/', bookingRequestLimiter, closedWhenReadOnly(), proof.requireProof, ctrl.create);
router.post('/:id/pay', paymentStartLimiter, requireOnlinePayment, payCtrl.pay);
router.get('/:id/status', paymentStatusLimiter, requireOnlinePayment, payCtrl.status);

module.exports = router;
