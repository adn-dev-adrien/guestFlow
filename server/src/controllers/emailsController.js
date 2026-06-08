/**
 * Emails controller — orchestrates the preview / send / pending / acknowledge / history
 * flows (specs/email-automation.md §4.1 + §4.3).
 *
 * Renders templates against the live reservation context, ships them via the existing
 * `emailService.send` SMTP path, and logs every attempt in `email_log`. Same SMTP
 * config as the admin "first connection" email — single `From:`, single transport.
 *
 * Error model:
 *   404 TEMPLATE_NOT_FOUND, RESERVATION_NOT_FOUND, CLIENT_NO_EMAIL
 *   409 EMAIL_NOT_CONFIGURED   ← SMTP host/from missing or password decrypt failed
 *   500 EMAIL_SEND_FAILED      ← nodemailer threw at send time
 */

const { renderTemplate } = require('../utils/emailTemplateRenderer');
const { buildContext }   = require('../utils/emailContextBuilder');

/**
 * Pull the enriched reservation graph the context builder consumes.
 * The cron + the controller share this loader so a regression on either path stays in
 * sync (no rendering drift between scheduled + manual sends).
 */
function loadReservationGraph(database, reservationId) {
  const id = Number(reservationId);
  const reservation = database.prepare(`
    SELECT * FROM reservations
    WHERE id = ? AND COALESCE(kind, 'reservation') = 'reservation'
  `).get(id);
  if (!reservation) return null;
  const client = reservation.clientId
    ? database.prepare('SELECT * FROM clients WHERE id = ?').get(reservation.clientId)
    : null;
  const property = reservation.propertyId
    ? database.prepare('SELECT * FROM properties WHERE id = ?').get(reservation.propertyId)
    : null;
  // Joined options — surface `title` + `autoOptionType` for the renderer's bed-linen flag.
  const options = database.prepare(`
    SELECT ro.*, o.title, o.autoOptionType
    FROM reservation_options ro
    JOIN options o ON o.id = ro.optionId
    WHERE ro.reservationId = ?
  `).all(id);
  return { reservation, client, property, options };
}

function buildController({ database, templatesModel, logModel, settingsModel, emailServiceFactory }) {
  function readSettings() {
    return settingsModel.read();
  }

  function smtpConfigured() {
    if (typeof settingsModel.smtpConfigured === 'function') {
      return settingsModel.smtpConfigured();
    }
    const s = readSettings();
    return Boolean(String(s.smtpHost || '').trim()) && Boolean(String(s.smtpFromEmail || '').trim());
  }

  function buildEmailService() {
    const smtp = settingsModel.decryptedSmtpSettings();
    return emailServiceFactory(smtp);
  }

  function buildPreview(reservationId, templateId, overrides = {}) {
    const template = templatesModel.findById(templateId);
    if (!template) return { error: 'TEMPLATE_NOT_FOUND', status: 404 };
    const graph = loadReservationGraph(database, reservationId);
    if (!graph) return { error: 'RESERVATION_NOT_FOUND', status: 404 };

    const context = buildContext({
      reservation: graph.reservation,
      client:      graph.client,
      property:    graph.property,
      options:     graph.options,
      settings:    readSettings(),
    });

    const useTemplate = {
      subject: overrides.subject != null ? String(overrides.subject) : template.subject,
      body:    overrides.body    != null ? String(overrides.body)    : template.body,
    };
    const { subject, body, missingVariables } = renderTemplate(useTemplate, context);

    return {
      ok: true,
      template,
      reservationId: Number(reservationId),
      to: String(graph.client?.email || '').trim(),
      subject,
      body,
      missingVariables,
    };
  }

  // ---------- HTTP handlers ----------

  function preview(req, res) {
    const { reservationId, templateId } = req.query || {};
    if (!reservationId || !templateId) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', fields: ['reservationId', 'templateId'] });
    }
    const result = buildPreview(Number(reservationId), Number(templateId));
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json({
      to: result.to,
      subject: result.subject,
      body: result.body,
      missingVariables: result.missingVariables,
    });
  }

  async function send(req, res) {
    const { reservationId, templateId, overrides } = req.body || {};
    if (!reservationId || !templateId) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', fields: ['reservationId', 'templateId'] });
    }
    const result = buildPreview(Number(reservationId), Number(templateId), overrides || {});
    if (result.error) return res.status(result.status).json({ error: result.error });
    if (!result.to)   return res.status(404).json({ error: 'CLIENT_NO_EMAIL' });

    if (!smtpConfigured()) {
      // Audit trail: log the failure so the operator sees the trace on the history page.
      const failed = logModel.insert({
        templateId:      Number(templateId),
        reservationId:   Number(reservationId),
        status:          'failed',
        errorMessage:    'EMAIL_NOT_CONFIGURED',
        renderedSubject: result.subject,
        renderedBody:    result.body,
        recipientEmail:  result.to,
      });
      return res.status(409).json({ error: 'EMAIL_NOT_CONFIGURED', emailLogId: failed.id });
    }

    try {
      const svc = buildEmailService();
      await svc.send({ to: result.to, subject: result.subject, text: result.body });
      const row = logModel.insert({
        templateId:      Number(templateId),
        reservationId:   Number(reservationId),
        status:          'sent',
        errorMessage:    '',
        renderedSubject: result.subject,
        renderedBody:    result.body,
        recipientEmail:  result.to,
      });
      return res.json({ ok: true, emailLogId: row.id, sentAt: row.sentAt });
    } catch (err) {
      const failed = logModel.insert({
        templateId:      Number(templateId),
        reservationId:   Number(reservationId),
        status:          'failed',
        errorMessage:    String(err?.message || 'unknown'),
        renderedSubject: result.subject,
        renderedBody:    result.body,
        recipientEmail:  result.to,
      });
      const code = err?.code === 'EMAIL_NOT_CONFIGURED' ? 409 : 500;
      return res.status(code).json({
        error: err?.code === 'EMAIL_NOT_CONFIGURED' ? 'EMAIL_NOT_CONFIGURED' : 'EMAIL_SEND_FAILED',
        emailLogId: failed.id,
      });
    }
  }

  function pending(req, res) {
    const today = (req.query && req.query.today) || new Date().toISOString().slice(0, 10);
    const lookbackDays = Number((req.query && req.query.lookbackDays) || 7);
    const rows = logModel.listPending({ today, lookbackDays });
    return res.json(rows);
  }

  function acknowledge(req, res) {
    const { templateId, reservationId } = req.params || {};
    if (!templateId || !reservationId) return res.status(400).json({ error: 'INVALID_PAYLOAD' });

    const template = templatesModel.findById(templateId);
    if (!template) return res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' });
    const graph = loadReservationGraph(database, reservationId);
    if (!graph) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });

    // Idempotent: a second acknowledge for the same pair is a no-op (the pending list
    // already filters out any pair with an existing 'sent' or 'acknowledged-skip' row).
    if (logModel.existsFor(Number(templateId), Number(reservationId), ['sent', 'acknowledged-skip'])) {
      return res.json({ ok: true, alreadyHandled: true });
    }

    const context = buildContext({
      reservation: graph.reservation,
      client:      graph.client,
      property:    graph.property,
      options:     graph.options,
      settings:    readSettings(),
    });
    const { subject, body } = renderTemplate(
      { subject: template.subject, body: template.body },
      context,
    );

    const row = logModel.insert({
      templateId:      Number(templateId),
      reservationId:   Number(reservationId),
      status:          'acknowledged-skip',
      errorMessage:    '',
      renderedSubject: subject,
      renderedBody:    body,
      recipientEmail:  String(graph.client?.email || '').trim(),
    });
    return res.json({ ok: true, emailLogId: row.id });
  }

  function history(req, res) {
    const { limit, offset, reservationId, templateId, status } = req.query || {};
    const result = logModel.history({
      limit:         limit  != null ? Number(limit)  : 50,
      offset:        offset != null ? Number(offset) : 0,
      reservationId: reservationId != null ? Number(reservationId) : undefined,
      templateId:    templateId    != null ? Number(templateId)    : undefined,
      status,
    });
    return res.json(result);
  }

  return {
    preview, send, pending, acknowledge, history,
    // Exposed for the scheduled task: it reuses the same render → send → log pipeline.
    buildPreview,
    smtpConfigured,
    buildEmailService,
  };
}

module.exports = { buildController };
