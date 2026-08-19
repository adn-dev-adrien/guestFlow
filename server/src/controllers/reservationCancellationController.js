/**
 * Cancelling a stay — HTTP layer (specs/payment-schedule-and-cancellation.md §3.5).
 *
 * The dashboard proposes the cancellation once an unpaid solde has passed its deadline, and the
 * reservation page offers it too; the operator confirms. Nothing here ever fires on its own — the
 * cron never cancels a booking.
 *
 * Thin by design: the whole transactional sequence (audit entry → `kind` flip → requalification pair
 * → payment-link cleanup) lives in `utils/cancelReservation.js`, where it can be tested without
 * Qonto or SMTP. What is left here is HTTP shaping plus the two side effects that must happen AFTER
 * the commit and must never be able to undo it: the Google Calendar delete and the guest's notice.
 */

const db = require('../database');
const reservationsModel = require('../models/reservationsModel');
const refundsModel = require('../models/refundsModel');
const compensationsModel = require('../models/cancellationCompensationsModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const settingsModel = require('../models/settingsModel');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const googleCalendarSync = require('../utils/googleCalendarSync');
const { createEmailService } = require('../utils/emailService');
const { sendReservationTemplateEmail } = require('../utils/reservationEmailSender');
const { cancelReservation } = require('../utils/cancelReservation');
const { getTodayIsoDate } = require('../utils/reservationHelpers');

// POST /api/reservations/:id/cancel — { reason?, notifyClient? }
async function cancel(req, res) {
  const id = Number(req.params.id);
  const result = cancelReservation(
    { database: db, reservationsModel, refundsModel, compensationsModel, paymentLinksModel },
    id,
    {
      reason: (req.body && req.body.reason) || '',
      cancelledBy: req.user ? req.user.id : null,
      today: getTodayIsoDate(),
      vatRate: Number(settingsModel.read().vatRate || 0),
    },
  );
  if (result.error) return res.status(result.status).json({ error: result.message, code: result.error });

  let emailSent = false;
  if (req.body && req.body.notifyClient && result.clientEmail) {
    try {
      const sendResult = await sendReservationTemplateEmail({
        database: db,
        templatesModel: emailTemplatesModel,
        logModel: emailLogModel,
        settingsModel,
        emailServiceFactory: createEmailService,
        reservationId: id,
        stableKey: 'cancellation_notice',
      });
      emailSent = Boolean(sendResult && sendResult.sent);
    } catch (err) {
      // The stay IS cancelled — a failed notice must not undo it, only be reported.
      console.error('[cancellation-notice] send failed:', err && err.message);
    }
  }

  res.json({
    ok: true,
    cancellationReason: result.cancellationReason,
    retainedDepositAmount: result.retainedDepositAmount,
    writtenOffBalance: result.writtenOffBalance,
    refundId: result.refundId,
    compensationId: result.compensationId,
    emailSent,
  });
  // Fire-and-forget, exactly like a delete: the dates are free in GuestFlow the moment the
  // transaction commits, and Google catches up right after.
  googleCalendarSync.scheduleDelete(id);
}

module.exports = { cancel };
