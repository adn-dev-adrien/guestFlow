/**
 * Public email-preferences page (specs/guest-email-sequence.md §4.3). Mounted OUTSIDE `/api` and
 * `/public/v1`: a guest opens it from an email, with no session and no API key. The token in the
 * link is the only credential, and a dedicated rate limiter keeps it from being brute-forced.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const { buildController } = require('../controllers/public/emailPreferencesController');
const db = require('../database');
const preferences = require('../models/emailPreferencesModel');

const router = express.Router();
const controller = buildController({ preferences, database: db });

router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.EMAIL_PREFERENCES_RATELIMIT_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
}));
router.get('/emails', controller.show);
router.post('/emails', express.urlencoded({ extended: false, limit: '2kb' }), controller.confirm);

module.exports = router;
