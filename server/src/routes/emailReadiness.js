// specs/guest-email-texts-made-simple.md rules 6–7 — what would render badly. Admin-only.
const router = require('express').Router();
const { buildController } = require('../controllers/emailReadinessController');

const controller = buildController({ database: require('../database'), settingsModel: require('../models/settingsModel') });

router.get('/', controller.get);

module.exports = router;
// Read by the home's « À traiter » (specs/shell-and-home-day-first.md rule 7).
module.exports.controller = controller;
