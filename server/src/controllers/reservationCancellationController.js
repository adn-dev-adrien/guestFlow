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

const { isOptionalText } = require('../utils/bodyText');
const db = require('../database');
const reservationsModel = require('../models/reservationsModel');
const refundsModel = require('../models/refundsModel');
const compensationsModel = require('../models/cancellationCompensationsModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const installmentsModel = require('../models/installmentsModel');
const settingsModel = require('../models/settingsModel');
const vatRegimeModel = require('../models/vatRegimeModel');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const { emit: emitPluginEvent } = require('../plugins/sdk/eventBus');
const { createEmailService } = require('../utils/emailService');
const { sendReservationTemplateEmail } = require('../utils/reservationEmailSender');
const { cancelReservation, cancellationPreview } = require('../utils/cancelReservation');
const { deactivateAbandonedLinks } = require('../utils/paymentLinkDeactivation');
const { getTodayIsoDate } = require('../utils/reservationHelpers');
const { ENGLISH_VERSION_MISSING } = require('../utils/emailTemplateLanguage');

// specs/email-language-fr-en.md rule 12 — a notice asked for and not sent is told to the operator.
const NOTICE_NOT_SENT = Object.freeze({
  [ENGLISH_VERSION_MISSING]: 'version anglaise manquante',
  'no-template': 'modèle désactivé',
  'no-email': 'adresse e-mail manquante',
});
function cancellationNoticeWarning(reason) {
  return `Mail d’annulation non envoyé : ${NOTICE_NOT_SENT[reason] || 'envoi impossible'}.`;
}

const cancellationDeps = () => ({ database: db, reservationsModel, refundsModel, compensationsModel, paymentLinksModel, installmentsModel });

// specs/payment-schedule-and-cancellation.md rule 60 — what cancelling stay `id` now would keep and write off, from the
// very figures `cancel` writes; the refusal the cancel would answer otherwise.
function previewFor(id) {
  return cancellationPreview(cancellationDeps(), id, { today: getTodayIsoDate(), vatRate: vatRegimeModel.rateForRow(db, { id }) });
}

// GET /api/reservations/:id/cancel-preview
function preview(req, res) {
  const result = previewFor(Number(req.params.id));
  if (result.error) return res.status(result.status).json({ error: result.message, code: result.error });
  return res.json({
    cancellationReason: result.cancellationReason,
    retainedDepositAmount: result.retainedDepositAmount,
    indemnityAmount: result.indemnityAmount,
    // Rule 60 reading (audit R45-C-L1) — the sum the notice states as kept (rule 61), shown before the operator confirms.
    keptFromGuest: result.keptFromGuest,
    writtenOffBalance: result.writtenOffBalance,
  });
}

// POST /api/reservations/:id/cancel — { reason?, notifyClient? }
async function cancel(req, res) {
  const id = Number(req.params.id);
  if (!isOptionalText(req.body && req.body.reason)) return res.status(400).json({ error: 'Valeur invalide.', code: 'INVALID_FIELD', field: 'reason' });
  const result = cancelReservation(cancellationDeps(), id, {
    reason: (req.body && req.body.reason) || '',
    cancelledBy: req.user ? req.user.id : null,
    today: getTodayIsoDate(),
    vatRate: vatRegimeModel.rateForRow(db, { id }),
  });
  if (result.error) return res.status(result.status).json({ error: result.message, code: result.error });

  // specs/plugins-phase-3a-online-payment.md rules 7, 9 — the stay is cancelled whatever the provider
  // answers; a link it could not deactivate is retried by the poll and named to the operator.
  const { notDeactivated } = await deactivateAbandonedLinks(result.cancelledLinks, { paymentLinksModel });
  const providerLabel = (require('../utils/paymentProviders').declared() || {}).label || 'le prestataire de paiement';

  let emailSent = false;
  let emailReason = null;
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
      if (!emailSent) emailReason = (sendResult && sendResult.reason) || 'failed';
    } catch (err) {
      emailReason = 'failed';
      // The stay IS cancelled — a failed notice must not undo it, only be reported.
      console.error('[cancellation-notice] send failed:', err && err.message);
    }
  }

  res.json({
    ok: true,
    cancellationReason: result.cancellationReason,
    retainedDepositAmount: result.retainedDepositAmount,
    indemnityAmount: result.indemnityAmount,
    // Rule 61 — the sum the notice states as kept (the indemnity plus a caisse-interne acompte kept).
    keptFromGuest: result.keptFromGuest,
    writtenOffBalance: result.writtenOffBalance,
    refundId: result.refundId,
    compensationId: result.compensationId,
    emailSent,
    emailWarning: emailReason ? cancellationNoticeWarning(emailReason) : null,
    paymentLinksNotDeactivated: notDeactivated,
    paymentLinksWarning: notDeactivated > 0
      ? `Lien de paiement encore actif chez ${providerLabel} : à désactiver depuis ${providerLabel}.`
      : null,
  });
  // Fire-and-forget, exactly like a delete: the dates are free in GuestFlow the moment the
  // transaction commits, and the plugins (Google) catch up right after.
  emitPluginEvent('reservation.cancelled', { reservationId: Number(id) });
}

module.exports = { cancel, preview, previewFor };
