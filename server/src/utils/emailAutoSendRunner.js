/**
 * Email auto-send runner — invoked by the daily 08:00 cron (specs/email-automation.md
 * §3 rule 7). Iterates every enabled `auto` template + every matching reservation;
 * skips pairs that already produced a `sent` row in `email_log`; renders + sends + logs.
 *
 * Pure orchestration — DB, SMTP and renderer all injected so the test harness can swap
 * them out (no need to spin up nodemailer in a unit test).
 *
 * Returns `{ sentCount, skippedCount, failedCount, results: [{ templateId, reservationId,
 * status, errorMessage? }] }` so the caller can log a one-line summary + the test can
 * assert behaviour.
 */

const { renderTemplate } = require('./emailTemplateRenderer');
const { buildContext }   = require('./emailContextBuilder');

function isoToday(now = new Date()) {
  // Use the server's local date — same locale the cron fires at 08:00 of.
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * @param {{ database, templatesModel, logModel, settingsModel, emailServiceFactory,
 *           today?: string }} deps
 */
async function performAutoEmailPass(deps) {
  const { database, templatesModel, logModel, settingsModel, emailServiceFactory } = deps;
  const today = deps.today || isoToday();
  const settings = settingsModel.read();

  // 1. List every enabled auto template once. Manual templates are out of the cron's scope —
  // they surface on the dashboard pending list instead.
  const templates = templatesModel.listEnabled().filter((t) => t.sendMode === 'auto');
  if (templates.length === 0) {
    return { sentCount: 0, skippedCount: 0, failedCount: 0, results: [] };
  }

  // 2. Reservations matching `startDate + dayOffset = today`. One query per template keeps
  // the SQL simple and lets each template's offset stay independent.
  const findReservationsStmt = database.prepare(`
    SELECT * FROM reservations
    WHERE COALESCE(kind, 'reservation') = 'reservation'
      AND date(startDate, ? || ' days') = ?
  `);
  const findClient   = database.prepare('SELECT * FROM clients WHERE id = ?');
  const findProperty = database.prepare('SELECT * FROM properties WHERE id = ?');
  const findOptions  = database.prepare(`
    SELECT ro.*, o.title, o.autoOptionType
    FROM reservation_options ro
    JOIN options o ON o.id = ro.optionId
    WHERE ro.reservationId = ?
  `);
  const findResources = database.prepare(`
    SELECT rr.*, res.name
    FROM reservation_resources rr
    JOIN resources res ON res.id = rr.resourceId
    WHERE rr.reservationId = ?
  `);
  const findCustomOptions = database.prepare(`
    SELECT * FROM reservation_custom_options WHERE reservationId = ?
  `);
  // Property provides bed linen by default? (specs/j1-linen-default-message.md §3 rule 1)
  const findBedLinenDefault = database.prepare(`
    SELECT 1 FROM property_option_defaults d
    JOIN options o ON o.id = d.optionId
    WHERE d.propertyId = ? AND o.autoOptionType = 'bed_linen' AND d.offered = 1
    LIMIT 1
  `);

  // Build the email service lazily: a misconfigured SMTP must not crash the cron —
  // every send attempt logs `failed` with the actionable error code.
  let serviceCache = null;
  function getService() {
    if (serviceCache) return serviceCache;
    serviceCache = emailServiceFactory(settingsModel.decryptedSmtpSettings());
    return serviceCache;
  }

  const results = [];
  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const template of templates) {
    const reservations = findReservationsStmt.all(String(template.dayOffset), today);
    for (const reservation of reservations) {
      // Skip pairs we've already shipped.
      if (logModel.existsFor(template.id, reservation.id, ['sent'])) {
        skippedCount += 1;
        results.push({ templateId: template.id, reservationId: reservation.id, status: 'skipped-already-sent' });
        continue;
      }

      const client   = reservation.clientId   ? findClient.get(reservation.clientId)     : null;
      const property = reservation.propertyId ? findProperty.get(reservation.propertyId) : null;
      const options  = findOptions.all(reservation.id);
      const resources = findResources.all(reservation.id);
      const customOptions = findCustomOptions.all(reservation.id);
      const bedLinenProvidedByDefault = reservation.propertyId
        ? Boolean(findBedLinenDefault.get(reservation.propertyId))
        : false;

      const context = buildContext({ reservation, client, property, options, resources, customOptions, bedLinenProvidedByDefault, settings });
      const { subject, body } = renderTemplate(
        { subject: template.subject, body: template.body },
        context,
      );
      const to = String(client?.email || '').trim();

      if (!to) {
        const row = logModel.insert({
          templateId:      template.id,
          reservationId:   reservation.id,
          status:          'failed',
          errorMessage:    'CLIENT_NO_EMAIL',
          renderedSubject: subject,
          renderedBody:    body,
          recipientEmail:  '',
        });
        failedCount += 1;
        results.push({ templateId: template.id, reservationId: reservation.id, status: 'failed', errorMessage: 'CLIENT_NO_EMAIL', emailLogId: row.id });
        continue;
      }

      try {
        const svc = getService();
        await svc.send({ to, subject, text: body });
        const row = logModel.insert({
          templateId:      template.id,
          reservationId:   reservation.id,
          status:          'sent',
          channel:         'smtp',
          errorMessage:    '',
          renderedSubject: subject,
          renderedBody:    body,
          recipientEmail:  to,
        });
        sentCount += 1;
        results.push({ templateId: template.id, reservationId: reservation.id, status: 'sent', emailLogId: row.id });
      } catch (err) {
        const errMsg = err?.code === 'EMAIL_NOT_CONFIGURED' ? 'EMAIL_NOT_CONFIGURED' : String(err?.message || 'unknown');
        const row = logModel.insert({
          templateId:      template.id,
          reservationId:   reservation.id,
          status:          'failed',
          errorMessage:    errMsg,
          renderedSubject: subject,
          renderedBody:    body,
          recipientEmail:  to,
        });
        failedCount += 1;
        results.push({ templateId: template.id, reservationId: reservation.id, status: 'failed', errorMessage: errMsg, emailLogId: row.id });
      }
    }
  }

  return { sentCount, skippedCount, failedCount, results };
}

module.exports = {
  performAutoEmailPass,
  isoToday,
};
