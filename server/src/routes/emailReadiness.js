// specs/guest-email-texts-made-simple.md rules 6–7 — what would render badly. Admin-only.
const router = require('express').Router();
const { buildController } = require('../controllers/emailReadinessController');

const controller = buildController({ database: require('../database'), settingsModel: require('../models/settingsModel') });

router.get('/', controller.get);

module.exports = router;
