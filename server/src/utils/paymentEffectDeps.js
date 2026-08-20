/**
 * Shared wiring for the PAID-link effect (specs/public-online-payment.md §3/§3bis). Builds the deps
 * object consumed by `processPaidLink` / `runPaymentPoll` — used identically by the cron poll, the
 * on-demand status poll and the Qonto webhook, so the confirmation + conflict behaviour is one code
 * path everywhere. Bound to the real models (the unit tests inject their own stubs instead).
 */

const database = require('../database');
const devisModel = require('../models/devisModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const reservationsModel = require('../models/reservationsModel');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const settingsModel = require('../models/settingsModel');
const { createEmailService } = require('./emailService');
const { buildGatedConfirmationSender } = require('./reservationEmailSender');
const emailManualQueueModel = require('../models/emailManualQueueModel');
const notificationService = require('./notificationService');

// Confirmation email for a just-paid reservation. Gated by the master switch: when automatic
// sending is off it is queued for the operator instead of mailed
// (specs/no-automatic-email-without-approval.md §3 rule 4).
const sendConfirmation = buildGatedConfirmationSender({
  database, templatesModel: emailTemplatesModel, logModel: emailLogModel,
  settingsModel, emailServiceFactory: createEmailService,
  queueModel: emailManualQueueModel,
  onQueueError: (err) => console.error('[payments] could not queue the confirmation email:', err && err.message ? err.message : err),
});

// Dates no longer free for a just-confirmed reservation? Re-uses the authoritative availability check,
// excluding the reservation itself; `allowPastDates` so only the OVERLAP rule (not the past guard) flags.
function checkConflict({ reservationId }) {
  const r = database.prepare('SELECT propertyId, startDate, endDate, checkInTime, checkOutTime FROM reservations WHERE id = ?').get(Number(reservationId));
  if (!r) return false;
  const res = reservationsModel.validateAvailability(
    r.propertyId, r.startDate, r.endDate, r.checkInTime, r.checkOutTime, Number(reservationId), {}, { allowPastDates: true },
  );
  return Boolean(res && res.error);
}

function buildPaymentEffectDeps() {
  return {
    database,
    devisModel,
    paymentLinksModel,
    sendConfirmation,
    checkConflict,
    notifyConflict: (reservationId) => notificationService.notifyBookingConflict(reservationId),
  };
}

module.exports = { buildPaymentEffectDeps, checkConflict };
