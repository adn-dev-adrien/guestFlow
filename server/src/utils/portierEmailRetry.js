/**
 * Emails waiting for Portier (specs/gate-access-portier.md §3.2 — decision 2026-09-14: « on attend et
 * on ré-essaye »).
 *
 * An email whose template carries the gate paragraph never leaves without it. When Portier cannot give
 * the invitation, the email is not composed: its log row becomes `waiting_portier` and is retried after
 * 1, 2, 5 and 15 minutes, then every 15 minutes, until Portier answers. Rows are retried in the order
 * they started waiting.
 *
 *   - ONE timer, armed only while such rows exist, for the earliest due moment — none otherwise.
 *   - A wait longer than an hour notifies the admins, once per email.
 *   - A waiting email whose reservation is no longer a live stay, or whose template was disabled,
 *     is dropped and logged `skipped`.
 *
 * Composition and delivery are injected: the default instance composes through the emails controller,
 * the very render → send path of a manual « Envoyer ».
 */

const RETRY_STEPS_MINUTES = [1, 2, 5, 15];
const STEADY_STEP_MINUTES = 15;
const NOTIFY_AFTER_MS = 60 * 60 * 1000;
const WAITING_MESSAGE = "Portier ne répond pas : l'email partira dès qu'il répond.";

/** Attempts fall at waitingSince + 1, 3, 8, 23, 38, 53… minutes; the next one strictly after now. */
function nextAttemptAt(waitingSinceMs, nowMs) {
  const elapsed = nowMs - waitingSinceMs;
  let offset = 0;
  for (let i = 0; ; i += 1) {
    offset += (i < RETRY_STEPS_MINUTES.length ? RETRY_STEPS_MINUTES[i] : STEADY_STEP_MINUTES) * 60e3;
    if (offset > elapsed) return waitingSinceMs + offset;
  }
}

function emailLabel(row) {
  const offset = Number(row.templateDayOffset);
  return Number.isFinite(offset) && offset < 0 ? `J${offset}` : `« ${row.templateName || 'sans nom'} »`;
}

function createEmailRetry({
  logModel,
  compose,
  deliver,
  notifyAdmins,
  formatClock,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  logger = console,
}) {
  let timer = null;
  let running = false;
  let rerun = false;
  const iso = (ms) => new Date(ms).toISOString();

  function arm() {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    let wake = null;
    for (const row of logModel.listWaitingPortier()) {
      const candidates = [Date.parse(row.nextAttemptAt)];
      if (!row.adminNotifiedAt) candidates.push(Date.parse(row.waitingSince) + NOTIFY_AFTER_MS);
      for (const at of candidates) if (Number.isFinite(at) && (wake === null || at < wake)) wake = at;
    }
    if (wake === null) return;
    timer = setTimer(() => {
      timer = null;
      return runDue();
    }, Math.max(0, wake - now()));
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  /** A send that has to wait. `subject` is kept for the history; the body is composed at retry. */
  function queue({ templateId, reservationId, subject = '', recipientEmail = '' }) {
    const nowMs = now();
    const row = logModel.insertWaitingPortier({
      templateId,
      reservationId,
      renderedSubject: subject,
      recipientEmail,
      waitingSince: iso(nowMs),
      nextAttemptAt: iso(nextAttemptAt(nowMs, nowMs)),
    });
    arm();
    return row;
  }

  async function runOnce() {
    let portierDown = false;
    for (const row of logModel.listWaitingPortier()) {
      const nowMs = now();
      if (Date.parse(row.nextAttemptAt) <= nowMs) {
        if (String(row.reservationKind || '') !== 'reservation') {
          logModel.resolveWaitingPortier(row.id, { status: 'skipped', errorMessage: 'RESERVATION_CANCELLED' });
          continue;
        }
        if (Number(row.templateEnabled) !== 1) {
          logModel.resolveWaitingPortier(row.id, { status: 'skipped', errorMessage: 'TEMPLATE_DISABLED' });
          continue;
        }
        // One knock per pass: once Portier has not answered, the later rows only get their next date.
        const composed = portierDown ? { wait: true } : await compose(row);
        if (composed.wait) {
          portierDown = true;
          logModel.rescheduleWaitingPortier(row.id, iso(nextAttemptAt(Date.parse(row.waitingSince), nowMs)));
        } else if (composed.error) {
          logModel.resolveWaitingPortier(row.id, { status: 'failed', errorMessage: composed.error });
          continue;
        } else {
          const to = composed.to || row.recipientEmail;
          try {
            await deliver({ to, subject: composed.subject, body: composed.body });
            logModel.resolveWaitingPortier(row.id, {
              status: 'sent', renderedSubject: composed.subject, renderedBody: composed.body, recipientEmail: to,
            });
          } catch (err) {
            logModel.resolveWaitingPortier(row.id, {
              status: 'failed', errorMessage: String((err && err.message) || 'unknown'),
              renderedSubject: composed.subject, renderedBody: composed.body, recipientEmail: to,
            });
          }
          continue;
        }
      }
      if (!row.adminNotifiedAt && nowMs - Date.parse(row.waitingSince) >= NOTIFY_AFTER_MS) {
        logModel.markWaitingPortierNotified(row.id, iso(nowMs));
        await notifyAdmins({
          title: 'Email en attente de Portier',
          body: `Email ${emailLabel(row)} de ${row.clientFirstName || 'votre client'} en attente : Portier ne répond pas ${formatClock(row.waitingSince)}`,
          url: '/emails/historique',
          tag: `guestflow-portier-email-${row.id}`,
        });
      }
    }
  }

  async function runDue() {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      do {
        rerun = false;
        await runOnce();
      } while (rerun);
    } catch (err) {
      logger.error('[portier] waiting emails pass failed:', err && err.message ? err.message : err);
    } finally {
      running = false;
      arm();
    }
  }

  return { queue, arm, runDue, hasTimer: () => Boolean(timer) };
}

let defaultRetry = null;

function getDefault() {
  if (!defaultRetry) {
    const database = require('../database');
    const logModel = require('../models/emailLogModel');
    const settingsModel = require('../models/settingsModel');
    const { createEmailService } = require('./emailService');
    const { buildController } = require('../controllers/emailsController');
    const { sinceText } = require('./portierAccessView');
    const controller = buildController({
      database,
      templatesModel: require('../models/emailTemplatesModel'),
      logModel,
      settingsModel,
      paymentLinksModel: require('../models/paymentLinksModel'),
      emailServiceFactory: createEmailService,
    });
    defaultRetry = createEmailRetry({
      logModel,
      compose: (row) => controller.composeForSend(row.reservationId, row.templateId),
      deliver: ({ to, subject, body }) => createEmailService(settingsModel.decryptedSmtpSettings()).send({ to, subject, text: body }),
      notifyAdmins: (payload) => require('./adminPush').pushToAdmins(payload),
      formatClock: (waitingSince) => sinceText(waitingSince, Date.now()),
    });
  }
  return defaultRetry;
}

module.exports = {
  queue: (input) => getDefault().queue(input),
  arm: () => getDefault().arm(),
  createEmailRetry,
  nextAttemptAt,
  WAITING_MESSAGE,
};
