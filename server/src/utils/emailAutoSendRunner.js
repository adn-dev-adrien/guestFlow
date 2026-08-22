/**
 * Email auto-send runner — invoked by the daily 08:00 pass that `utils/emailAutoSendScheduler`
 * schedules (specs/email-automation.md §3 rule 7). Iterates every enabled `auto` template + every
 * matching reservation;
 * skips pairs that already produced a `sent` row in `email_log`; renders + sends + logs.
 *
 * Pure orchestration — DB, SMTP and renderer all injected so the test harness can swap
 * them out (no need to spin up nodemailer in a unit test).
 *
 * Returns `{ sentCount, skippedCount, failedCount, results: [{ templateId, reservationId,
 * status, errorMessage? }] }` so the caller can log a one-line summary + the test can
 * assert behaviour. Adds `blocked: true` when the operator has not authorised automatic sending
 * (specs/no-automatic-email-without-approval.md §3 rule 2) — the pass then does nothing at all.
 */

const { renderTemplate } = require('./emailTemplateRenderer');
const { buildContext }   = require('./emailContextBuilder');
const { normaliseLang, pickTemplateSide } = require('./emailTemplateLanguage');
const reservationsModel = require('../models/reservationsModel');
const { DIRECT_CHANNELS } = require('./platformNameFormat');
const { autoSendAllowed } = require('./autoSendPolicy');

// Bound as parameters (never interpolated) so the own-channel list stays single-sourced in
// platformNameFormat.js — adding a channel there reaches this pass for free. Same pattern as
// balanceRequestRunner.
const DIRECT_CHANNEL_LIST = [...DIRECT_CHANNELS];
const DIRECT_CHANNEL_PLACEHOLDERS = DIRECT_CHANNEL_LIST.map(() => '?').join(', ');

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

  // 0. The master switch (specs/no-automatic-email-without-approval.md §3 rule 2). OFF → this pass is
  // a no-op: nothing is listed, nothing is rendered, no SMTP connection is opened and no `email_log`
  // row is written. The day's due templates are not lost — `emailLogModel.listPending` surfaces them
  // in the « à valider » queue instead, where one click sends them.
  // Defence in depth since rule 2b: the scheduler does not register a timer while the switch is off,
  // so nothing should reach this guard. It stays because a pass that mails guests must decide for
  // itself, whatever scheduled it — and the caller shuts the timer down on `blocked`.
  if (!autoSendAllowed(settingsModel)) {
    return { blocked: true, sentCount: 0, skippedCount: 0, failedCount: 0, results: [] };
  }

  const settings = settingsModel.read();

  // 1. List every enabled auto template once. Manual templates are out of the cron's scope —
  // they surface on the dashboard pending list instead.
  const templates = templatesModel.listEnabled().filter((t) => t.sendMode === 'auto');
  if (templates.length === 0) {
    return { sentCount: 0, skippedCount: 0, failedCount: 0, results: [] };
  }

  // 2. Reservations matching `<anchor date> + dayOffset = today`. One query per anchor, picked per
  // template, so each template's offset stays independent (specs/email-automation.md §3 rule 7 +
  // specs/payment-schedule-and-cancellation.md §3.7 rule 41).
  //   • 'start'          → the arrival date (legacy default);
  //   • 'depositDueDate' → the acompte deadline, and only while the acompte is still unpaid;
  //   • 'balanceDueDate' → the solde deadline, same guard.
  // A payment anchor whose échéance gets paid stops matching immediately: the dunning email cannot
  // chase money that has arrived, dedup or no dedup.
  const findReservationsStmt = database.prepare(`
    SELECT * FROM reservations
    WHERE COALESCE(kind, 'reservation') = 'reservation'
      AND date(startDate, ? || ' days') = ?
  `);
  // specs/platform-payout-due-date.md §3.3 rules 22-23 — a MONEY template never leaves for a platform
  // booking. Its acompte and solde are the platform's, not the guest's: asking an Airbnb guest for a
  // solde they already paid Airbnb is wrong whatever the date. This mirrors the filter
  // `balanceRequestRunner.selectEligible` has always had; without it the `balance_reminder` template
  // (auto, enabled, offset +3) reached OTA guests. The `start` anchor is deliberately NOT filtered:
  // arrival emails (welcome, check-in instructions…) are legitimate on any channel.
  const paymentAnchorStmt = (anchor, amountColumn, paidColumn) => database.prepare(`
    SELECT * FROM reservations
    WHERE COALESCE(kind, 'reservation') = 'reservation'
      AND ${anchor} IS NOT NULL
      AND COALESCE(${amountColumn}, 0) > 0
      AND COALESCE(${paidColumn}, 0) != 1
      AND date(${anchor}, ? || ' days') = ?
      AND LOWER(COALESCE(NULLIF(TRIM(platform), ''), 'direct')) IN (${DIRECT_CHANNEL_PLACEHOLDERS})
  `);
  // Each anchor carries the extra bound parameters ITS query needs, after the shared (offset, today).
  const statementsByAnchor = {
    start: { statement: findReservationsStmt, extraParams: [] },
    depositDueDate: {
      statement: paymentAnchorStmt('depositDueDate', 'depositAmount', 'depositPaid'),
      extraParams: DIRECT_CHANNEL_LIST,
    },
    balanceDueDate: {
      statement: paymentAnchorStmt('balanceDueDate', 'balanceAmount', 'balancePaid'),
      extraParams: DIRECT_CHANNEL_LIST,
    },
  };
  const findClient   = database.prepare('SELECT * FROM clients WHERE id = ?');
  const findProperty = database.prepare('SELECT * FROM properties WHERE id = ?');
  const findOptions  = database.prepare(`
    SELECT ro.*, o.title, o.titleEn, o.autoOptionType, o.displayToClient
    FROM reservation_options ro
    JOIN options o ON o.id = ro.optionId
    WHERE ro.reservationId = ?
  `);
  const findResources = database.prepare(`
    SELECT rr.*, res.name, res.nameEn
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
    // An unknown anchor (a 'validUntil' template flipped to `auto` by hand — the devis queue is
    // manual by design) has no auto-send query: skip it rather than silently mailing the wrong set.
    const anchorQuery = statementsByAnchor[template.anchor || 'start'];
    if (!anchorQuery) {
      results.push({ templateId: template.id, status: 'skipped-unsupported-anchor', anchor: template.anchor });
      continue;
    }
    const reservations = anchorQuery.statement.all(String(template.dayOffset), today, ...anchorQuery.extraParams);
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

      // specs/email-client-language-and-fiche-polish.md §3 rule 2: render in the CLIENT's language (then the
      // reservation as a transitional fallback, then FR). EN body if filled, else FR.
      const lang = normaliseLang((client && client.emailLanguage) || reservation.emailLanguage);
      // specs/j2-email-arrival-complement-line.md — same arrival-complement breakdown as the SAS recap.
      // Guarded: getByIdWithDetails needs the full schema (minimal test schemas → null → inline fallback).
      let arrivalComplementDetail = null;
      try { arrivalComplementDetail = reservationsModel.create(database).buildArrivalComplementDetail(reservation.id); }
      catch { arrivalComplementDetail = null; }
      const context = buildContext({ reservation, client, property, options, resources, customOptions, bedLinenProvidedByDefault, settings, lang, arrivalComplementDetail });
      const side = pickTemplateSide(template, lang);
      const { subject, body } = renderTemplate(
        { subject: side.subject, body: side.body },
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
