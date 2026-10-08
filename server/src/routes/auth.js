const router = require('express').Router();
const c = require('../controllers/authController');

// Public: login + me (probe). Session-bound: logout + change-password (checked inside the controller).
// This router is mounted OUTSIDE requireAuth so a restricted session can still change its password.
router.post('/login', c.login);
router.post('/logout', c.logout);
router.get('/me', c.me);
router.post('/change-password', c.changePassword);

// specs/hosting-h2-account-security.md — public: what the login page offers, the forgotten password
// (rules 1–5), the second step of a pending login (rules 7–8), the support sign-in link (rule 14).
router.get('/options', c.options);
router.post('/forgot', c.forgotPassword);
router.get('/reset', c.checkResetToken);
router.post('/reset', c.resetPassword);
router.post('/2fa/verify', c.verifySecondFactor);
router.post('/2fa/resend', c.resendSecondFactor);
router.get('/support', c.supportLogin);

// Session-bound: the user's own second step (rule 6) and the dashboard card's « Plus tard » (rule 10).
router.get('/2fa/status', c.twoFactorStatus);
router.post('/2fa/start', c.twoFactorStart);
router.post('/2fa/confirm', c.twoFactorConfirm);
router.post('/2fa/disable', c.twoFactorDisable);
router.post('/2fa/backup-codes', c.twoFactorRegenerate);
router.post('/2fa/snooze', c.twoFactorSnooze);

module.exports = router;
