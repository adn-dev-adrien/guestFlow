const router = require('express').Router();

const { buildController } = require('../controllers/emailsController');
const db = require('../database');
const templatesModel = require('../models/emailTemplatesModel');
const logModel       = require('../models/emailLogModel');
const settingsModel  = require('../models/settingsModel');
const { createEmailService } = require('../utils/emailService');

const controller = buildController({
  database: db,
  templatesModel,
  logModel,
  settingsModel,
  emailServiceFactory: createEmailService,
});

router.get('/preview', controller.preview);
router.post('/send',   controller.send);
router.get('/pending', controller.pending);
router.post('/pending/:templateId/:reservationId/acknowledge', controller.acknowledge);
router.get('/history', controller.history);

module.exports = router;
