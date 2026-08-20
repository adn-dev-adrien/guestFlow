/**
 * Send a single templated email for a reservation, by `stableKey` (specs/online-payments-qonto.md
 * §3.4). Event-triggered counterpart of the dayOffset cron — used to send the « Confirmation de
 * réservation » email the moment an online payment confirms a stay. Mirrors emailAutoSendRunner's
 * load → context → render → send → log pipeline; every dependency is injected for testability.
 *
 * Returns `{ sent, reason?, emailLogId? }`. Never throws — a misconfigured SMTP is logged as `failed`
 * so the payment flow that calls it is never broken by an email error.
 */

const { renderTemplate } = require('./emailTemplateRenderer');
const { buildContext } = require('./emailContextBuilder');
const { normaliseLang, pickTemplateSide } = require('./emailTemplateLanguage');
const { autoSendAllowed } = require('./autoSendPolicy');

async function sendReservationTemplateEmail({ database, templatesModel, logModel, settingsModel, emailServiceFactory, reservationId, stableKey, extraContext }) {
  const template = templatesModel.findByStableKey(stableKey);
  if (!template || !template.enabled) return { sent: false, reason: 'no-template' };

  const reservation = database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(reservationId));
  if (!reservation) return { sent: false, reason: 'no-reservation' };

  const client = reservation.clientId ? database.prepare('SELECT * FROM clients WHERE id = ?').get(reservation.clientId) : null;
  const property = reservation.propertyId ? database.prepare('SELECT * FROM properties WHERE id = ?').get(reservation.propertyId) : null;
  const options = database.prepare(`
    SELECT ro.*, o.title, o.titleEn, o.autoOptionType
    FROM reservation_options ro JOIN options o ON o.id = ro.optionId WHERE ro.reservationId = ?
  `).all(reservation.id);
  const resources = database.prepare(`
    SELECT rr.*, res.name, res.nameEn
    FROM reservation_resources rr JOIN resources res ON res.id = rr.resourceId WHERE rr.reservationId = ?
  `).all(reservation.id);
  const customOptions = database.prepare('SELECT * FROM reservation_custom_options WHERE reservationId = ?').all(reservation.id);
  const bedLinenProvidedByDefault = reservation.propertyId
    ? Boolean(database.prepare(`
        SELECT 1 FROM property_option_defaults d JOIN options o ON o.id = d.optionId
        WHERE d.propertyId = ? AND o.autoOptionType = 'bed_linen' AND d.offered = 1 LIMIT 1
      `).get(reservation.propertyId))
    : false;

  const to = String((client && client.email) || '').trim();
  if (!to) return { sent: false, reason: 'no-email' };

  const settings = settingsModel.read();
  const lang = normaliseLang((client && client.emailLanguage) || reservation.emailLanguage);
  const context = buildContext({ reservation, client, property, options, resources, customOptions, bedLinenProvidedByDefault, settings, lang });
  // Per-send overrides (e.g. the payment link, which isn't a reservation column) are merged over the
  // built context's vars/flags so callers can inject values without touching emailContextBuilder.
  const extra = extraContext || {};
  const merged = {
    vars:  { ...context.vars,  ...(extra.vars || {}) },
    flags: { ...context.flags, ...(extra.flags || {}) },
  };
  const side = pickTemplateSide(template, lang);
  const { subject, body } = renderTemplate({ subject: side.subject, body: side.body }, merged);

  try {
    const svc = emailServiceFactory(settingsModel.decryptedSmtpSettings());
    await svc.send({ to, subject, text: body });
    const row = logModel.insert({
      templateId: template.id, reservationId: reservation.id, status: 'sent', channel: 'smtp',
      errorMessage: '', renderedSubject: subject, renderedBody: body, recipientEmail: to,
    });
    return { sent: true, emailLogId: row && row.id, recipientEmail: to };
  } catch (err) {
    const errMsg = err && err.code === 'EMAIL_NOT_CONFIGURED' ? 'EMAIL_NOT_CONFIGURED' : String((err && err.message) || 'unknown');
    logModel.insert({
      templateId: template.id, reservationId: reservation.id, status: 'failed',
      errorMessage: errMsg, renderedSubject: subject, renderedBody: body, recipientEmail: to,
    });
    return { sent: false, reason: errMsg };
  }
}

/**
 * Curry the dependencies into a `sendConfirmation(reservationId)` function suitable for
 * `runPaymentPoll({ sendConfirmation })`. Defaults the stableKey to the confirmation template.
 */
function buildConfirmationSender({ database, templatesModel, logModel, settingsModel, emailServiceFactory, stableKey = 'reservation_confirmation' }) {
  return (reservationId) => sendReservationTemplateEmail({
    database, templatesModel, logModel, settingsModel, emailServiceFactory, reservationId, stableKey,
  });
}

/**
 * Same confirmation sender, gated by the master switch
 * (specs/no-automatic-email-without-approval.md §3 rule 4).
 *
 * A confirmed online payment is not an operator action — nobody read that email before it left. So:
 *   switch ON  → send immediately, as before;
 *   switch OFF → send nothing and queue the (template, reservation) pair, which puts the
 *                confirmation in « Emails à envoyer » for the operator to review and send.
 *
 * `queueModel.add` is idempotent (INSERT OR IGNORE), so the webhook and the poll cron racing on the
 * same payment propose it once. Never throws: an email must not break a payment flow.
 */
function buildGatedConfirmationSender({
  database, templatesModel, logModel, settingsModel, emailServiceFactory, queueModel,
  stableKey = 'reservation_confirmation', onQueueError,
}) {
  const send = buildConfirmationSender({
    database, templatesModel, logModel, settingsModel, emailServiceFactory, stableKey,
  });
  return async (reservationId) => {
    if (autoSendAllowed(settingsModel)) return send(reservationId);
    try {
      const template = templatesModel.findByStableKey(stableKey);
      // No template, or the operator disabled it → nothing to propose. Mirrors the `no-template`
      // early return of the sender: a disabled template is a deliberate « don't send this ».
      if (!template || !template.enabled) return { sent: false, reason: 'no-template' };
      queueModel.add(template.id, Number(reservationId));
      return { sent: false, reason: 'auto-send-disabled', queued: true };
    } catch (err) {
      if (onQueueError) onQueueError(err);
      return { sent: false, reason: 'queue-failed' };
    }
  };
}

module.exports = { sendReservationTemplateEmail, buildConfirmationSender, buildGatedConfirmationSender };
