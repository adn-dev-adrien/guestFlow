const router = require('express').Router();

const { buildController } = require('../controllers/emailSequenceController');
const db = require('../database');
const ledger = require('../models/guestEmailSendsModel');
const settingsModel = require('../models/settingsModel');
const templatesModel = require('../models/emailTemplatesModel');

const controller = buildController({ database: db, ledger, settingsModel, templatesModel });

router.get('/simulation', controller.simulation);

module.exports = router;
