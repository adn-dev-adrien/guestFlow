/**
 * Payments routes (specs/online-payments-qonto.md §4.3). Thin — delegates to paymentsController.
 * Mounted at /api/payments behind the standard session guard (see index.js).
 */

const express = require('express');

const router = express.Router();
const ctrl = require('../controllers/paymentsController');

// Qonto OAuth connect flow.
router.get('/qonto/authorize', ctrl.qontoAuthorize);
router.get('/qonto/callback', ctrl.qontoCallback);
router.get('/qonto/status', ctrl.qontoStatus);

// The application credentials and the connection test, so a broken Qonto setup can be repaired from
// the interface alone (specs/qonto-settings-in-app.md §3 rules 1, 9, 16). Session-guarded like the
// rest of /api/payments/**.
router.get('/qonto/credentials', ctrl.getQontoCredentials);
router.put('/qonto/credentials', ctrl.updateQontoCredentials);
router.post('/qonto/test', ctrl.testQontoConnection);

// Qonto payment webhook — public (no session; HMAC-verified in the controller). The /api auth guard in
// index.js exempts this exact path. specs/public-online-payment.md §3bis.
const qontoWebhookController = require('../controllers/qontoWebhookController');
router.post('/qonto/webhook', qontoWebhookController.handleWebhook);
// Admin one-shot: register the payment-link webhook subscription with Qonto.
router.post('/qonto/webhook/register', ctrl.registerQontoWebhook);

// Qonto payment-links provider connection.
router.get('/qonto/bank-accounts', ctrl.qontoBankAccounts);
router.post('/qonto/connect-provider', ctrl.qontoConnectProvider);
router.get('/qonto/refresh-connection', ctrl.qontoRefreshConnection);

// Paiements settings page: configurable timings + the Qonto connection state.
router.get('/settings', ctrl.getSettings);
router.put('/settings', ctrl.updateSettings);

// Payment links on a reservation/devis + the manual poll trigger (specs/online-payments-qonto.md §3.4 / §7).
router.post('/reservations/:id/payment-links', ctrl.createReservationPaymentLink);
router.get('/reservations/:id/payment-links', ctrl.listReservationPaymentLinks);
router.post('/reservations/:id/payment-emails', ctrl.sendPaymentRequestEmail);
router.post('/poll', ctrl.pollPaymentsNow);

module.exports = router;
