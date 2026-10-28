/**
 * Payments routes (specs/online-payments-qonto.md §4.3). Thin — delegates to paymentsController.
 * Mounted at /api/payments behind the standard session guard (see index.js).
 *
 * Only the provider-neutral routes are the core's (specs/plugins-phase-3a-online-payment.md rule 11):
 * the Qonto settings, OAuth and webhook under /api/payments/qonto/* and /api/payments/settings are
 * mounted by the online-payment plugin.
 */

const express = require('express');

const router = express.Router();
const ctrl = require('../controllers/paymentsController');
const db = require('../database');
const { guardReadOnly } = require('../utils/reservationReadOnly');

// No link, no request on a cancelled stay or on a duplicate set aside (specs/calendar-property-parity.md rule 22).
const noWriteOnClosedStay = guardReadOnly(db, { cancelled: true });

// Payment links on a reservation/devis + the manual poll trigger (specs/online-payments-qonto.md §3.4 / §7).
router.post('/reservations/:id/payment-links', noWriteOnClosedStay, ctrl.createReservationPaymentLink);
router.get('/reservations/:id/payment-links', ctrl.listReservationPaymentLinks);
router.post('/reservations/:id/payment-emails', noWriteOnClosedStay, ctrl.sendPaymentRequestEmail);
router.post('/poll', ctrl.pollPaymentsNow);

module.exports = router;
