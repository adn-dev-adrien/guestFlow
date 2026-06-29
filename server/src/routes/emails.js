const router = require('express').Router();

const { buildController } = require('../controllers/emailsController');
const db = require('../database');
const templatesModel = require('../models/emailTemplatesModel');
const logModel       = require('../models/emailLogModel');
const manualQueueModel = require('../models/emailManualQueueModel');
const settingsModel  = require('../models/settingsModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const { createEmailService } = require('../utils/emailService');

const controller = buildController({
  database: db,
  templatesModel,
  logModel,
  manualQueueModel,
  settingsModel,
  paymentLinksModel,
  emailServiceFactory: createEmailService,
});

router.get('/preview', controller.preview);
router.post('/send',   controller.send);
router.get('/pending', controller.pending);
router.post('/pending/:templateId/:reservationId/acknowledge', controller.acknowledge);
router.post('/pending/:templateId/:reservationId/mark-sent', controller.markSent);
router.get('/history', controller.history);
router.get('/eligible-reservations', controller.eligibleReservations);
router.post('/queue', controller.queue);

module.exports = router;
