/**
 * Guest email sequence — the daily pass and the simulation (specs/guest-email-sequence.md §3.3-§3.6).
 *
 * `planWindow` is the single eligibility path: the 08:00 pass sends what it returns with status
 * `send`, the simulation page and the CLI display the same rows. Nothing here decides a date or an
 * exclusion — utils/guestEmailSequence does; this module adds what needs the database: the ledger
 * (already sent?) and the yearly cap.
 *
 * `sendSequenceMail` is the only function that mails a sequence email. Every path goes through it —
 * the pass, the payment confirmation, the « Envoyer » button — and it claims the ledger key BEFORE
 * opening SMTP (rule 12): a key another path already holds sends nothing.
 */

const { autoSendAllowed } = require('./autoSendPolicy');
const {
  MAIL_LABELS, REASONS, POST_STAY_STABLE_KEYS, planStayMails, planSeasonMail, seasonSendDates, capReached,
  __test: { addDays },
} = require('./guestEmailSequence');

const CATCH_UP_DAYS = 2;
const STALE_CLAIM_MINUTES = 60;

function isoToday(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------- planning

function loadClients(database, ids) {
  const map = new Map();
  const list = [...new Set(ids.filter((id) => id != null).map(Number))];
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    database.prepare(`SELECT * FROM clients WHERE id IN (${chunk.map(() => '?').join(', ')})`)
      .all(...chunk).forEach((c) => map.set(Number(c.id), c));
  }
  return map;
}

/**
 * Every sequence email whose send date falls within [from, to], with its status.
 * @returns {Array<{ stableKey, dedupKey, sendDate, reservationId, clientId, seasonKey, blocked, status, reason }>}
 *   status: 'send' | 'blocked' | 'already-sent' | 'to-check'
 */
function planWindow({ database, ledger, from, to, startDate }) {
  const stayRows = database.prepare(`
    SELECT * FROM reservations
     WHERE COALESCE(kind, 'reservation') IN ('reservation', 'cancelled')
       AND (   date(createdAt) BETWEEN @from AND @to
            OR date(startDate, '-7 days') BETWEEN @from AND @to
            OR date(startDate, '-2 days') BETWEEN @from AND @to
            OR date(endDate, '+1 day') BETWEEN @from AND @to)
  `).all({ from, to });

  const seasonDates = seasonSendDates(from, to);
  const seasonStays = seasonDates.length
    ? database.prepare("SELECT * FROM reservations WHERE COALESCE(kind, 'reservation') = 'reservation' AND clientId IS NOT NULL").all()
    : [];

  const clients = loadClients(database, [...stayRows, ...seasonStays].map((r) => r.clientId));

  const entries = [];
  for (const reservation of stayRows) {
    const client = clients.get(Number(reservation.clientId)) || null;
    for (const plan of planStayMails({ reservation, client, startDate })) {
      if (plan.sendDate >= from && plan.sendDate <= to) entries.push(plan);
    }
  }
  if (seasonDates.length) {
    const staysByClient = new Map();
    for (const stay of seasonStays) {
      const key = Number(stay.clientId);
      if (!staysByClient.has(key)) staysByClient.set(key, []);
      staysByClient.get(key).push(stay);
    }
    for (const { stableKey, sendDate } of seasonDates) {
      for (const [clientId, stays] of staysByClient) {
        const client = clients.get(clientId);
        if (!client) continue;
        const plan = planSeasonMail({ stableKey, client, stays, sendDate, startDate });
        if (plan) entries.push(plan);
      }
    }
  }

  // Ledger: a closed key never sends again; a claim left open is for a human to check (rule 14).
  const ledgerRows = ledger.findByKeys(entries.map((e) => e.dedupKey));
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MINUTES * 60000).toISOString().replace('T', ' ').slice(0, 19);
  // Cap (rule 8): chronological, counting what the ledger holds plus what this window would send.
  const plannedPerClient = new Map();
  entries.sort((a, b) => (a.sendDate < b.sendDate ? -1 : a.sendDate > b.sendDate ? 1 : 0));
  for (const entry of entries) {
    const row = ledgerRows.get(entry.dedupKey);
    if (row && row.status !== 'failed') {
      if (row.status === 'claimed') {
        entry.status = row.claimedAt <= staleBefore ? 'to-check' : 'already-sent';
        entry.reason = entry.status === 'to-check' ? 'Envoi commencé puis interrompu : à vérifier, jamais renvoyé automatiquement' : 'Envoi en cours';
      } else {
        entry.status = 'already-sent';
        entry.reason = row.status === 'skipped' ? 'Ignoré par l\'opérateur' : `Déjà envoyé le ${String(row.sentAt || '').slice(0, 10)}`;
      }
      continue;
    }
    if (entry.blocked) {
      entry.status = 'blocked';
      entry.reason = REASONS[entry.blocked] || entry.blocked;
      continue;
    }
    if (POST_STAY_STABLE_KEYS.includes(entry.stableKey) && entry.clientId != null) {
      const since = `${addDays(entry.sendDate, -365)} 00:00:00`;
      const planned = (plannedPerClient.get(entry.clientId) || []).filter((d) => d > addDays(entry.sendDate, -365)).length;
      if (capReached(ledger.countPostStayContacts(entry.clientId, since) + planned)) {
        entry.status = 'blocked';
        entry.blocked = 'capReached';
        entry.reason = REASONS.capReached;
        continue;
      }
      plannedPerClient.set(entry.clientId, [...(plannedPerClient.get(entry.clientId) || []), entry.sendDate]);
    }
    entry.status = 'send';
    entry.reason = '';
  }
  return entries;
}

// ---------------------------------------------------------------- sending

/**
 * Render and send ONE sequence email through the ledger.
 * @param {object} deps { database, ledger, templatesModel, logModel, settingsModel, emailServiceFactory, preferences }
 * @param {object} plan { stableKey, dedupKey, reservationId, clientId, seasonKey, sendDate }
 * @param {object} [opts] { to } — operator-typed recipient (send dialog); { lang } — forced language
 * @returns {Promise<{ sent: boolean, reason?: string, emailLogId?: number, recipientEmail?: string, subject?, body? }>}
 */
async function sendSequenceMail(deps, plan, opts = {}) {
  // Loaded here, not at the top: the rendering chain reaches the default database module, and the
  // planning half of this file must stay free of it so the CLI simulation opens its target read-only.
  const { renderTemplate } = require('./emailTemplateRenderer');
  const { buildContext } = require('./emailContextBuilder');
  const { normaliseLang, pickTemplateSide } = require('./emailTemplateLanguage');
  const { loadReservationGraph } = require('./reservationEmailGraph');
  const { sequenceContextFor } = require('./sequenceRenderContext');
  const { database, ledger, templatesModel, logModel, settingsModel, emailServiceFactory, preferences } = deps;
  const template = templatesModel.findByStableKey(plan.stableKey);
  if (!template || !template.enabled) return { sent: false, reason: 'no-template' };
  const graph = loadReservationGraph(database, plan.reservationId);
  if (!graph) return { sent: false, reason: 'no-reservation' };
  const to = String((graph.client && graph.client.email) || opts.to || '').trim();
  if (!to) return { sent: false, reason: 'no-email' };

  if (!ledger.claim({
    dedupKey: plan.dedupKey, stableKey: plan.stableKey, reservationId: plan.reservationId,
    clientId: graph.client ? graph.client.id : plan.clientId, seasonKey: plan.seasonKey,
  })) {
    return { sent: false, reason: 'already-sent' };
  }

  const settings = settingsModel.read();
  const lang = normaliseLang(opts.lang || (graph.client && graph.client.emailLanguage) || graph.reservation.emailLanguage);
  const sequence = sequenceContextFor({
    stableKey: plan.stableKey, reservation: graph.reservation, client: graph.client, settings, preferences,
    sendDate: plan.seasonKey ? plan.sendDate : undefined,
  });
  const context = buildContext({ ...graph, settings, lang, sequence });
  const side = pickTemplateSide(template, lang);
  const { subject, body } = renderTemplate({ subject: side.subject, body: side.body }, context);

  try {
    const service = emailServiceFactory(settingsModel.decryptedSmtpSettings());
    await service.send({ to, subject, text: body });
    const row = logModel.insert({
      templateId: template.id, reservationId: graph.reservation.id, status: 'sent', channel: 'smtp',
      errorMessage: '', renderedSubject: subject, renderedBody: body, recipientEmail: to,
    });
    ledger.markSent(plan.dedupKey, { recipientEmail: to, emailLogId: row && row.id });
    return { sent: true, emailLogId: row && row.id, recipientEmail: to, subject, body };
  } catch (err) {
    const message = err && err.code === 'EMAIL_NOT_CONFIGURED' ? 'EMAIL_NOT_CONFIGURED' : String((err && err.message) || 'unknown');
    logModel.insert({
      templateId: template.id, reservationId: graph.reservation.id, status: 'failed',
      errorMessage: message, renderedSubject: subject, renderedBody: body, recipientEmail: to,
    });
    ledger.markFailed(plan.dedupKey, message);
    return { sent: false, reason: message, errorCode: err && err.code };
  }
}

// ---------------------------------------------------------------- the daily pass

async function runSequencePass(deps, { today = isoToday() } = {}) {
  const { database, ledger, settingsModel } = deps;
  if (!autoSendAllowed(settingsModel)) return { blocked: true, sent: 0, failed: 0, results: [] };
  const startDate = settingsModel.read().guestSequenceStartDate;
  if (!startDate) return { blocked: true, sent: 0, failed: 0, results: [] };

  // Rule 17: today, plus the last CATCH_UP_DAYS still unclaimed — never before the start date.
  const catchUp = addDays(today, -CATCH_UP_DAYS);
  const from = catchUp > startDate ? catchUp : startDate;
  const plan = planWindow({ database, ledger, from, to: today, startDate });

  const results = [];
  let sent = 0;
  let failed = 0;
  for (const entry of plan.filter((e) => e.status === 'send')) {
    const outcome = await sendSequenceMail(deps, entry);
    if (outcome.sent) sent += 1;
    else if (outcome.reason !== 'already-sent') failed += 1;
    results.push({ dedupKey: entry.dedupKey, ...outcome });
  }
  return { blocked: false, sent, failed, results };
}

// ---------------------------------------------------------------- the simulation

/**
 * What the sequence would send between `from` and `to` (rule 31). No SMTP, no ledger write. Before
 * activation, the start date is assumed to be today so the operator sees what activating would do.
 */
function simulate({ database, ledger, settingsModel }, { from, to, today = isoToday() }) {
  const settings = settingsModel.read();
  const startDate = settings.guestSequenceStartDate || today;
  const entries = planWindow({ database, ledger, from, to, startDate });

  const reservationIds = [...new Set(entries.map((e) => e.reservationId).filter(Boolean))];
  const reservations = new Map();
  // `reservationNumber` is added by a boot migration; a baseline-only database simply has none.
  const hasNumber = database.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'reservationNumber');
  for (let i = 0; i < reservationIds.length; i += 500) {
    const chunk = reservationIds.slice(i, i + 500);
    database.prepare(`
      SELECT r.id, ${hasNumber ? 'r.reservationNumber' : "'' AS reservationNumber"}, r.clientId, p.name AS propertyName
        FROM reservations r LEFT JOIN properties p ON p.id = r.propertyId
       WHERE r.id IN (${chunk.map(() => '?').join(', ')})
    `).all(...chunk).forEach((r) => reservations.set(Number(r.id), r));
  }
  const clients = loadClients(database, entries.map((e) => e.clientId));

  const rows = entries.map((e) => {
    const reservation = reservations.get(Number(e.reservationId)) || {};
    const client = clients.get(Number(e.clientId)) || {};
    return {
      date: e.sendDate,
      mailKey: e.stableKey,
      mailLabel: MAIL_LABELS[e.stableKey] || e.stableKey,
      reservationId: e.reservationId,
      reservationNumber: reservation.reservationNumber || '',
      clientId: e.clientId,
      clientName: `${client.firstName || ''} ${client.lastName || ''}`.trim(),
      propertyName: reservation.propertyName || '',
      status: e.status,
      reason: e.reason || '',
    };
  });
  const counts = { send: 0, blocked: 0, alreadySent: 0, toCheck: 0 };
  for (const r of rows) {
    if (r.status === 'send') counts.send += 1;
    else if (r.status === 'blocked') counts.blocked += 1;
    else if (r.status === 'already-sent') counts.alreadySent += 1;
    else if (r.status === 'to-check') counts.toCheck += 1;
  }
  return {
    rows,
    counts,
    startDate: settings.guestSequenceStartDate || null,
    assumedStartDate: settings.guestSequenceStartDate ? null : startDate,
    autoSendEnabled: autoSendAllowed(settingsModel),
  };
}

module.exports = { planWindow, sendSequenceMail, runSequencePass, simulate, isoToday, CATCH_UP_DAYS };
