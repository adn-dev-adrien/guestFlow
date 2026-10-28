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

const { todayIso: localTodayIso } = require('../utils/localDate');
const { sendFailureMessage } = require('../utils/sendFailure');
const { parisDateTimeLabel } = require('../utils/parisDateTime');

const {
  normaliseLang, pickTemplateSide, englishMissing, ENGLISH_VERSION_MISSING, ENGLISH_VERSION_MISSING_MESSAGE, ENGLISH_VERSION_MISSING_ACTION,
} = require('../utils/emailTemplateLanguage');

// A stored failure reason as the history shows it: the known codes, else the transport's text read
// through sendFailureMessage (specs/email-automation.md rule 15).
const FAILURE_CODES = {
  CLIENT_NO_EMAIL: 'Pas d’adresse email.',
  NO_TEMPLATE: 'Modèle manquant.',
  [ENGLISH_VERSION_MISSING]: ENGLISH_VERSION_MISSING_MESSAGE,
};
function failureLabel(stored) {
  const text = String(stored || '').trim();
  if (!text) return '';
  if (FAILURE_CODES[text]) return FAILURE_CODES[text];
  if (/[àâçéèêëîïôûùüÿœ]/i.test(text) && !/^[A-Z_]+$/.test(text)) return text;
  return sendFailureMessage({ message: text, code: /^[A-Z_]+$/.test(text) ? text : '' });
}
const { renderTemplate } = require('../utils/emailTemplateRenderer');
const { buildContext }   = require('../utils/emailContextBuilder');
const { emailContext: pluginEmailContext } = require('../plugins/sdk/eventBus');
const paymentProviders = require('../utils/paymentProviders');
const { loadReservationGraph } = require('../utils/reservationEmailGraph');
const { refuseIfReadOnly } = require('../utils/reservationReadOnly');
const {
  SEQUENCE_STABLE_KEYS, SEASON_STABLE_KEYS, stayDedupKey, seasonDedupKey, seasonKeyOf,
  __test: { addDays },
} = require('../utils/guestEmailSequence');
const { sequenceContextFor, nextSeasonDate } = require('../utils/sequenceRenderContext');
const { resolveEmailIdentity } = require('../utils/emailIdentity');
const { buildDraftPreview } = require('../utils/emailDraftPreview');
const { guestEmailMessage } = require('../utils/guestEmailHtml');
const { displayNameOf } = require('../utils/emailTimeline');

// Templates that re-offer an existing payment link (injected read-only at preview/send time).
const PAYMENT_LINK_TEMPLATES = { deposit_reminder: 'deposit' };

// specs/direct-installments.md rules 19-21 — the request of one installment: it carries the plan in its
// variables and its own link, and is sent once per installment (the occurrence key).
const INSTALLMENT_STABLE_KEY = 'installment_request';

// `installmentRequests` (utils/installmentRequests.js) is what this controller knows of the plan:
//   available() → a payment provider can mint links;  resolve(reservationId, occurrenceKey) → the installment
//   to ask for ({ id, occurrenceKey, context, openLinkUrl }) or null;  ensureLink(reservationId, installmentId);
//   markRequested(installmentId).
function buildController({ database, templatesModel, logModel, settingsModel, emailServiceFactory, manualQueueModel, paymentLinksModel, ledger, preferences, installmentRequests = null, testMailer = null }) {
  // specs/guest-email-sequence.md rules 12-13bis — the ledger key a sequence email is sent under
  // from this controller. Null for every other template (payment emails keep their own rules).
  // A season email sent by hand counts for the season that just passed or is coming.
  function sequencePlanFor(template, graph) {
    if (!ledger || !template || !SEQUENCE_STABLE_KEYS.includes(template.stableKey)) return null;
    const stableKey = template.stableKey;
    const reservationId = Number(graph.reservation.id);
    const clientId = graph.client ? Number(graph.client.id) : null;
    if (!SEASON_STABLE_KEYS.includes(stableKey)) {
      return { stableKey, dedupKey: stayDedupKey(stableKey, reservationId), reservationId, clientId, seasonKey: null };
    }
    const today = localTodayIso();
    const sendDate = nextSeasonDate(stableKey, addDays(today, -60));
    const seasonKey = seasonKeyOf(stableKey, sendDate);
    return { stableKey, dedupKey: seasonDedupKey(stableKey, clientId, seasonKey), reservationId, clientId, seasonKey, sendDate };
  }

  // specs/guest-email-texts-made-simple.md rule 44 — the history and the pending list name a template
  // the way every other page does (« Merci et avis », not « Séquence — J+1 merci et avis »).
  function withDisplayNames(rows) {
    const names = new Map(templatesModel.list().map((t) => [Number(t.id), displayNameOf(t)]));
    return rows.map((row) => (names.has(Number(row.templateId)) ? { ...row, templateName: names.get(Number(row.templateId)) } : row));
  }

  function readSettings() {
    return settingsModel.read();
  }

  function smtpConfigured() {
    if (typeof settingsModel.smtpConfigured === 'function') {
      return settingsModel.smtpConfigured();
    }
    const s = readSettings();
    return Boolean(String(s.smtpHost || '').trim()) && Boolean(resolveEmailIdentity(s).fromEmail);
  }

  function buildEmailService() {
    const smtp = settingsModel.decryptedSmtpSettings();
    return emailServiceFactory(smtp);
  }

  // Explicit override wins, else the CLIENT's language, else the reservation's, else French.
  function guestLangOf(graph, lang) {
    return normaliseLang(lang || graph.client?.emailLanguage || graph.reservation.emailLanguage);
  }

  function buildPreview(reservationId, templateId, overrides = {}, lang, extra = {}) {
    const settings = { ...readSettings(), ...(extra.settings || {}) };
    const template = templatesModel.findById(templateId);
    if (!template) return { error: 'TEMPLATE_NOT_FOUND', status: 404 };
    const graph = loadReservationGraph(database, reservationId);
    if (!graph) return { error: 'RESERVATION_NOT_FOUND', status: 404 };

    // Language resolution (specs/email-client-language-and-fiche-polish.md §3 rule 2): explicit override
    // wins, else the CLIENT's language, else the reservation's (transitional fallback), else French.
    const useLang = guestLangOf(graph, lang);

    const installmentRef = template.stableKey === INSTALLMENT_STABLE_KEY && installmentRequests
      ? installmentRequests.resolve(reservationId, extra.occurrenceKey)
      : null;
    const context = buildContext({
      reservation: graph.reservation,
      client:      graph.client,
      property:    graph.property,
      options:     graph.options,
      resources:   graph.resources,
      customOptions: graph.customOptions,
      arrivalComplementDetail: graph.arrivalComplementDetail,
      bedLinenProvidedByDefault: graph.bedLinenProvidedByDefault,
      stayFacts:   graph.stayFacts,
      termsVersion: graph.termsVersion,
      sequence:    sequenceContextFor({
        stableKey: template.stableKey, reservation: graph.reservation, client: graph.client,
        settings, preferences, sendDate: (sequencePlanFor(template, graph) || {}).sendDate,
      }),
      settings,
      lang:        useLang,
      installment: installmentRef ? installmentRef.context : null,
      // The local copy of the invitation: composing an email never reaches the house.
      pluginContext: pluginEmailContext(reservationId),
    });

    // specs/plugin-removal-resilience.md rule 6 — a stored open link is re-offered only while a payment
    // provider is live: nobody polls or reconciles it otherwise.
    const providerLive = Boolean(paymentProviders.declared());
    if (installmentRef) {
      const url = extra.paymentLink || (providerLive ? installmentRef.openLinkUrl : '') || '';
      context.vars.paymentLink = url;
      context.flags.hasPaymentLink = Boolean(url);
    }

    // Payment-link templates (e.g. deposit_reminder) re-offer the existing OPEN link for the devis —
    // read-only, no Qonto write. Empty when there is none → the body falls back via {{#if hasPaymentLink}}.
    const linkType = PAYMENT_LINK_TEMPLATES[template.stableKey];
    if (linkType && providerLive && paymentLinksModel && typeof paymentLinksModel.findOpenForReservation === 'function') {
      const openLink = paymentLinksModel.findOpenForReservation(Number(reservationId), linkType);
      const url = openLink && openLink.url ? openLink.url : '';
      context.vars.paymentLink = url;
      context.flags.hasPaymentLink = Boolean(url);
    }

    // Template side for the language (EN if filled, else FR fallback). Operator overrides still win.
    const side = pickTemplateSide(template, useLang);
    const useTemplate = {
      subject: overrides.subject != null ? String(overrides.subject) : side.subject,
      body:    overrides.body    != null ? String(overrides.body)    : side.body,
    };
    const { subject, body, missingVariables } = renderTemplate(useTemplate, context);
    // The HTML part the guest receives beside the text (specs/guest-email-texts-made-simple.md rule 37).
    const { html } = guestEmailMessage({ subject, text: body, settings, lang: useLang });

    return {
      ok: true,
      template,
      graph,
      reservationId: Number(reservationId),
      clientId: graph.client?.id || null,
      to: String(graph.client?.email || '').trim(),
      subject,
      body,
      html,
      missingVariables,
      lang: useLang,
      // specs/email-language-fr-en.md rule 9 — shown, never sent.
      englishMissing: englishMissing(template, useLang),
      occurrenceKey: installmentRef ? installmentRef.occurrenceKey : '',
      installmentId: installmentRef ? installmentRef.id : null,
    };
  }

  // Basic shape check — the authoritative guard before we store an operator-typed address
  // on the client record / hand it to the SMTP transport.
  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  }

  // Persist an operator-typed recipient onto a client that had no email on file
  // (specs/email-automation.md §3 rule 10). Never overwrites an existing address.
  function persistClientEmailIfEmpty(clientId, email) {
    if (!clientId || !isValidEmail(email)) return;
    database
      .prepare("UPDATE clients SET email = ?, updatedAt = datetime('now') WHERE id = ? AND COALESCE(email, '') = ''")
      .run(String(email).trim(), Number(clientId));
  }

  // ---------- HTTP handlers ----------

  function preview(req, res) {
    const { reservationId, templateId, lang, occurrenceKey } = req.query || {};
    if (!reservationId || !templateId) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', fields: ['reservationId', 'templateId'] });
    }
    const result = buildPreview(Number(reservationId), Number(templateId), {}, lang, { occurrenceKey });
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json({
      to: result.to,
      subject: result.subject,
      body: result.body,
      html: result.html,
      missingVariables: result.missingVariables,
      lang: result.lang,
      englishMissing: result.englishMissing,
    });
  }

  async function send(req, res) {
    const { reservationId, templateId, overrides, lang, confirmResend, occurrenceKey } = req.body || {};
    if (!reservationId || !templateId) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', fields: ['reservationId', 'templateId'] });
    }
    // A duplicate set aside is never written to; a cancelled stay still receives its cancellation mails.
    if (refuseIfReadOnly(res, database, reservationId, { cancelled: false })) return undefined;
    const wanted = templatesModel.findById(templateId);
    // specs/email-language-fr-en.md rule 9 — a template without its English version never leaves for an
    // English-speaking guest, operator text or not; checked before any payment link is minted.
    const wantedGraph = wanted ? loadReservationGraph(database, reservationId) : null;
    if (wantedGraph && englishMissing(wanted, guestLangOf(wantedGraph, lang))) {
      return res.status(422).json({ error: ENGLISH_VERSION_MISSING, message: ENGLISH_VERSION_MISSING_ACTION });
    }
    // An installment request goes out with its own link, minted (or reused) at its exact amount.
    let paymentLink = null;
    if (wanted && wanted.stableKey === INSTALLMENT_STABLE_KEY && installmentRequests) {
      const target = installmentRequests.resolve(Number(reservationId), occurrenceKey);
      if (!target) return res.status(404).json({ error: 'INSTALLMENT_NOT_FOUND', message: 'Aucune échéance à demander.' });
      try {
        paymentLink = (await installmentRequests.ensureLink(Number(reservationId), target.id)).url;
      } catch (err) {
        return res.status(err.httpStatus || 502).json({ error: err.error || 'PAYMENT_LINK_FAILED', message: err.message || 'Lien de paiement impossible.' });
      }
    }
    const result = buildPreview(Number(reservationId), Number(templateId), overrides || {}, lang, { occurrenceKey, paymentLink });
    if (result.error) return res.status(result.status).json({ error: result.error });
    const sentKey = result.occurrenceKey;

    // Resolve the recipient: the client's email on file wins; otherwise the operator may
    // type one in the send dialog (overrides.to) for a client that has none. That typed
    // address is persisted onto the client record after a successful send (§3 rule 9).
    const overrideTo = String((overrides && overrides.to) || '').trim();
    const clientHadEmail = Boolean(result.to);
    const recipient = result.to || overrideTo;
    if (!recipient) return res.status(404).json({ error: 'CLIENT_NO_EMAIL' });
    if (!isValidEmail(recipient)) return res.status(400).json({ error: 'INVALID_EMAIL' });

    // Sequence email: one send per ledger key, whatever the path (rule 13). A deliberate resend is
    // the only exception and must say so (rule 13bis) — it gets a key of its own.
    const plan = sequencePlanFor(result.template, result.graph);
    if (plan) {
      const existing = ledger.findByKey(plan.dedupKey);
      if (existing && existing.status !== 'failed') {
        if (confirmResend !== true) {
          return res.status(409).json({ error: 'ALREADY_SENT', sentAt: existing.sentAt || existing.claimedAt, sentAtLabel: parisDateTimeLabel(existing.sentAt || existing.claimedAt), status: existing.status });
        }
        plan.dedupKey = ledger.nextResendKey(plan.dedupKey);
      }
      if (!ledger.claim(plan)) return res.status(409).json({ error: 'ALREADY_SENT' });
    }

    if (!smtpConfigured()) {
      // Audit trail: log the failure so the operator sees the trace on the history page.
      const failed = logModel.insert({
        templateId:      Number(templateId),
        reservationId:   Number(reservationId),
        status:          'failed',
        errorMessage:    'EMAIL_NOT_CONFIGURED',
        renderedSubject: result.subject,
        renderedBody:    result.body,
        recipientEmail:  recipient,
        occurrenceKey:   sentKey,
      });
      if (plan) ledger.markFailed(plan.dedupKey, 'EMAIL_NOT_CONFIGURED');
      return res.status(409).json({ error: 'EMAIL_NOT_CONFIGURED', emailLogId: failed.id });
    }

    try {
      const svc = buildEmailService();
      await svc.send({ to: recipient, subject: result.subject, text: result.body, html: result.html });
      // The send succeeded with an operator-typed address → save it on the client so the
      // next email finds it on file.
      if (!clientHadEmail) persistClientEmailIfEmpty(result.clientId, recipient);
      const row = logModel.insert({
        templateId:      Number(templateId),
        reservationId:   Number(reservationId),
        status:          'sent',
        channel:         'smtp',
        errorMessage:    '',
        renderedSubject: result.subject,
        renderedBody:    result.body,
        recipientEmail:  recipient,
        occurrenceKey:   sentKey,
      });
      if (plan) ledger.markSent(plan.dedupKey, { recipientEmail: recipient, emailLogId: row.id });
      if (result.installmentId) installmentRequests.markRequested(result.installmentId);
      // A manually-queued pair leaves the queue once sent (specs/manual-email-from-template.md §3 rule 7).
      if (manualQueueModel) manualQueueModel.remove(Number(templateId), Number(reservationId), sentKey);
      return res.json({ ok: true, emailLogId: row.id, sentAt: row.sentAt });
    } catch (err) {
      const failed = logModel.insert({
        templateId:      Number(templateId),
        reservationId:   Number(reservationId),
        status:          'failed',
        errorMessage:    String(err?.message || 'unknown'),
        renderedSubject: result.subject,
        renderedBody:    result.body,
        recipientEmail:  recipient,
        occurrenceKey:   sentKey,
      });
      if (plan) ledger.markFailed(plan.dedupKey, String(err?.message || 'unknown'));
      const code = err?.code === 'EMAIL_NOT_CONFIGURED' ? 409 : 500;
      return res.status(code).json({
        error: err?.code === 'EMAIL_NOT_CONFIGURED' ? 'EMAIL_NOT_CONFIGURED' : 'EMAIL_SEND_FAILED',
        message: sendFailureMessage(err),
        emailLogId: failed.id,
      });
    }
  }

  function pending(req, res) {
    const today = (req.query && req.query.today) || localTodayIso();
    const lookbackDays = Number((req.query && req.query.lookbackDays) || 7);
    // Only the « manual » templates are proposed: an « auto » one leaves on its own
    // (specs/settings-rationalization.md rule 17b).
    // An installment request needs a payment provider to mint its link: without one it is not proposed.
    const dateDriven = logModel.listPending({ today, lookbackDays })
      .filter((row) => !row.occurrenceKey || (installmentRequests && installmentRequests.available()));
    // Manually-queued pairs are shown unconditionally (they bypass the sent/ack filter — that is
    // what allows a deliberate resend, specs/manual-email-from-template.md §3 rule 6). Merge +
    // dedup by (templateId, reservationId): the manual flag wins so the UI can badge the row.
    const manual = (manualQueueModel ? manualQueueModel.listEnriched() : [])
      .filter((row) => !row.occurrenceKey || (installmentRequests && installmentRequests.available()));
    const key = (r) => `${r.templateId}:${r.reservationId}:${r.occurrenceKey || ''}`;
    const manualKeys = new Set(manual.map(key));
    const merged = [
      ...manual,
      ...dateDriven.filter((r) => !manualKeys.has(key(r))),
    ];
    merged.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))
      || Number(a.dayOffset) - Number(b.dayOffset));
    return res.json(withDisplayNames(merged));
  }

  function acknowledge(req, res) {
    const { templateId, reservationId } = req.params || {};
    if (!templateId || !reservationId) return res.status(400).json({ error: 'INVALID_PAYLOAD' });
    const occurrenceKey = String((req.query && req.query.occurrenceKey) || '');

    if (refuseIfReadOnly(res, database, reservationId, { cancelled: false })) return undefined;
    const template = templatesModel.findById(templateId);
    if (!template) return res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' });
    const graph = loadReservationGraph(database, reservationId);
    if (!graph) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });

    // Skipping always removes the pair from the manual queue, even when it was previously
    // sent/acknowledged (a re-queued pair must still be dismissable).
    if (manualQueueModel) manualQueueModel.remove(Number(templateId), Number(reservationId), occurrenceKey);
    // A skipped sequence email is closed in the ledger: the sequence never sends it afterwards.
    const skipPlan = sequencePlanFor(template, graph);
    if (skipPlan) ledger.recordOutsideSend({ ...skipPlan, status: 'skipped', note: 'ignoré par l\'opérateur' });

    // Idempotent: a second acknowledge for the same pair is a no-op (the pending list
    // already filters out any pair with an existing 'sent' or 'acknowledged-skip' row).
    if (logModel.existsFor(Number(templateId), Number(reservationId), ['sent', 'acknowledged-skip'], occurrenceKey)) {
      return res.json({ ok: true, alreadyHandled: true });
    }

    const context = buildContext({
      reservation: graph.reservation,
      client:      graph.client,
      property:    graph.property,
      options:     graph.options,
      resources:   graph.resources,
      customOptions: graph.customOptions,
      arrivalComplementDetail: graph.arrivalComplementDetail,
      bedLinenProvidedByDefault: graph.bedLinenProvidedByDefault,
      termsVersion: graph.termsVersion,
      settings:    readSettings(),
      lang:        normaliseLang(graph.client?.emailLanguage || graph.reservation.emailLanguage),
      pluginContext: pluginEmailContext(reservationId),
    });
    const side = pickTemplateSide(template, normaliseLang(graph.client?.emailLanguage || graph.reservation.emailLanguage));
    const { subject, body } = renderTemplate(
      { subject: side.subject, body: side.body },
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
      occurrenceKey,
    });
    return res.json({ ok: true, emailLogId: row.id });
  }

  // Mark a pending email as sent OUTSIDE GuestFlow (e.g. via the platform's messaging)
  // — specs/mark-email-sent-manually.md. Logs status='sent', channel='manual'; no SMTP, no
  // recipient required. Mirrors acknowledge's idempotency + queue-dequeue.
  function markSent(req, res) {
    const { templateId, reservationId } = req.params || {};
    if (!templateId || !reservationId) return res.status(400).json({ error: 'INVALID_PAYLOAD' });
    const occurrenceKey = String((req.query && req.query.occurrenceKey) || '');

    if (refuseIfReadOnly(res, database, reservationId, { cancelled: false })) return undefined;
    const template = templatesModel.findById(templateId);
    if (!template) return res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' });
    const graph = loadReservationGraph(database, reservationId);
    if (!graph) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });

    // Always dequeue, even if already handled (a re-queued pair must still leave the list).
    if (manualQueueModel) manualQueueModel.remove(Number(templateId), Number(reservationId), occurrenceKey);
    // An installment asked for outside GuestFlow counts as requested: the row says so, no link behind it.
    if (occurrenceKey && installmentRequests) {
      const target = installmentRequests.resolve(Number(reservationId), occurrenceKey);
      if (target) installmentRequests.markRequested(target.id);
    }
    const manualPlan = sequencePlanFor(template, graph);
    if (manualPlan) {
      ledger.recordOutsideSend({ ...manualPlan, status: 'sent', recipientEmail: String(graph.client?.email || '').trim(), note: 'envoyé hors GuestFlow' });
    }

    if (logModel.existsFor(Number(templateId), Number(reservationId), ['sent', 'acknowledged-skip'], occurrenceKey)) {
      return res.json({ ok: true, alreadyHandled: true });
    }

    const context = buildContext({
      reservation: graph.reservation,
      client:      graph.client,
      property:    graph.property,
      options:     graph.options,
      resources:   graph.resources,
      customOptions: graph.customOptions,
      arrivalComplementDetail: graph.arrivalComplementDetail,
      termsVersion: graph.termsVersion,
      settings:    readSettings(),
      pluginContext: pluginEmailContext(reservationId),
    });
    const { subject, body } = renderTemplate(
      { subject: template.subject, body: template.body },
      context,
    );

    const row = logModel.insert({
      templateId:      Number(templateId),
      reservationId:   Number(reservationId),
      status:          'sent',
      channel:         'manual',
      errorMessage:    '',
      renderedSubject: subject,
      renderedBody:    body,
      recipientEmail:  String(graph.client?.email || '').trim(),
      occurrenceKey,
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
    // specs/email-history-rolling-window.md rule 8 — the time as the operator lives it (Europe/Paris);
    // specs/email-automation.md rule 15 — a failure in French, not the transport's own words.
    const rows = withDisplayNames(result.rows || []).map((row) => ({
      ...row,
      sentAtLabel: parisDateTimeLabel(row.sentAt),
      errorLabel: row.status === 'failed' ? failureLabel(row.errorMessage) : '',
    }));
    return res.json({ ...result, rows });
  }

  // Compact reservation list for the "Créer un email" picker
  // (specs/manual-email-from-template.md §3 rule 2 + §4.3). All `kind='reservation'` rows,
  // most recent first, optionally filtered server-side by client / property name.
  function eligibleReservations(req, res) {
    const q = String((req.query && req.query.q) || '').trim();
    const params = [];
    let whereSearch = '';
    if (q) {
      whereSearch = `AND (
        LOWER(COALESCE(c.firstName,'') || ' ' || COALESCE(c.lastName,'')) LIKE ?
        OR LOWER(COALESCE(p.name,'')) LIKE ?
      )`;
      const like = `%${q.toLowerCase()}%`;
      params.push(like, like);
    }
    const rows = database.prepare(`
      SELECT
        r.id AS id,
        TRIM(COALESCE(c.firstName,'') || ' ' || COALESCE(c.lastName,'')) AS clientFullName,
        COALESCE(p.name,'') AS propertyName,
        r.startDate AS startDate,
        r.endDate   AS endDate
      FROM reservations r
      LEFT JOIN clients    c ON c.id = r.clientId
      LEFT JOIN properties p ON p.id = r.propertyId
      WHERE COALESCE(r.kind, 'reservation') = 'reservation'
      ${whereSearch}
      ORDER BY r.startDate DESC
    `).all(...params);
    return res.json(rows);
  }

  // Queue a (template, reservation) pair into "Emails à envoyer"
  // (specs/manual-email-from-template.md §3 rules 4-6 + §4.3).
  function queue(req, res) {
    const { templateId, reservationId, force } = req.body || {};
    if (!templateId || !reservationId) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', fields: ['templateId', 'reservationId'] });
    }
    if (refuseIfReadOnly(res, database, reservationId, { cancelled: false })) return undefined;
    const template = templatesModel.findById(templateId);
    if (!template) return res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' });
    const graph = loadReservationGraph(database, reservationId);
    if (!graph) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });

    // An installment request queued by hand is queued for the installment it will ask for: its key is stored,
    // so sending (which closes the entry under that key) really removes it.
    let occurrenceKey = '';
    if (template.stableKey === INSTALLMENT_STABLE_KEY && installmentRequests) {
      const target = installmentRequests.resolve(Number(reservationId), '');
      if (!target) return res.status(404).json({ error: 'INSTALLMENT_NOT_FOUND', message: 'Aucune échéance à demander.' });
      occurrenceKey = target.occurrenceKey;
    }

    // Already-sent guard: warn (with the last send date) unless the operator forces a resend.
    if (!force) {
      const lastSent = logModel.lastSentAt(Number(templateId), Number(reservationId), occurrenceKey);
      if (lastSent) {
        return res.json({ ok: false, alreadySent: true, lastSentAt: lastSent });
      }
    }

    manualQueueModel.add(Number(templateId), Number(reservationId), occurrenceKey);
    return res.json({ ok: true, queued: true });
  }

  // ---------- Draft preview and test send (specs/guest-email-texts-made-simple.md rules 13–15) ----------

  const draftPreview = buildDraftPreview({ database, templatesModel, buildPreview });

  function previewDraft(req, res) {
    const result = draftPreview.render(req.body || {});
    if (result.error) return res.status(result.status).json(result.body || { error: result.error });
    return res.json(result.payload);
  }

  // Rule 15 — the previewed email, to the company's own address, « [Test] » in front of the subject.
  // Nothing is written: no email_log row, no ledger key, no queue change. `testMailer` is the account
  // mailer, so a development instance's mail catcher (GUESTFLOW_MAIL_OUTBOX) receives the test too.
  async function sendTest(req, res) {
    if (!(testMailer ? testMailer.available() : smtpConfigured())) {
      return res.status(409).json({ error: 'EMAIL_NOT_CONFIGURED', message: 'SMTP non configuré : Paramètres › Emails' });
    }
    const result = draftPreview.render(req.body || {});
    if (result.error) return res.status(result.status).json(result.body || { error: result.error });
    const settings = readSettings();
    const to = String(settings.companyEmail || '').trim() || resolveEmailIdentity(settings).fromEmail;
    if (!to) return res.status(409).json({ error: 'NO_COMPANY_EMAIL', message: 'Email de l’entreprise manquant : Paramètres › Établissement' });
    try {
      const message = { to, subject: `[Test] ${result.payload.subject}`, text: result.payload.body, html: result.payload.html };
      if (testMailer) await testMailer.send(message);
      else await buildEmailService().send(message);
      return res.json({ ok: true, to });
    } catch (err) {
      const notConfigured = err && err.code === 'EMAIL_NOT_CONFIGURED';
      return res.status(notConfigured ? 409 : 500).json({
        error: notConfigured ? 'EMAIL_NOT_CONFIGURED' : 'EMAIL_SEND_FAILED',
        message: sendFailureMessage(err),
      });
    }
  }

  return {
    previewDraft, sendTest,
    preview, send, pending, acknowledge, markSent, history, queue, eligibleReservations,
    // Exposed for the scheduled task: it reuses the same render → send → log pipeline.
    buildPreview,
    smtpConfigured,
    buildEmailService,
  };
}

module.exports = { buildController };
