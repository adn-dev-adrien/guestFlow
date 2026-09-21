/**
 * Email auto-send scheduler — owns the 08:00 pass's timer, and owns it conditionally: while no
 * template is in « auto » mode, no timer exists at all (specs/no-automatic-email-without-approval.md
 * §3 rule 2b, specs/settings-rationalization.md rule 17b).
 *
 * Templates ship « manual », so on a default installation this module registers nothing: no
 * interval, no read, no log line.
 *
 * Two entry points drive it, and they are the only ones:
 *   - `scheduledTasks.startScheduledTasks()` at boot          → `syncWithTemplates({ boot: true })`;
 *   - `emailTemplatesController` on a template write/delete  → `syncWithTemplates()`.
 * Switching a template to « auto » therefore takes effect immediately, without a restart — the
 * transition itself runs the day's catch-up pass.
 *
 * `performAutoEmailPass` and `runSequencePass` keep their own per-template guard: a scheduler that
 * got out of step with the templates must still send nothing but « auto » templates.
 */

const db = require('../database');
const emailLogModel = require('../models/emailLogModel');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const settingsModel = require('../models/settingsModel');
const { createEmailService } = require('./emailService');
const { performAutoEmailPass, isoToday } = require('./emailAutoSendRunner');
const { anyTemplateAutoSends } = require('./autoSendPolicy');
const guestEmailSendsModel = require('../models/guestEmailSendsModel');
const emailPreferencesModel = require('../models/emailPreferencesModel');
const { runSequencePass } = require('./guestEmailSequenceRunner');

const TICK_INTERVAL = 60 * 1000;
// Boot passes stagger themselves so a restart doesn't run every job at once; the other
// scheduledTasks jobs sit at 30/60/90/95/105 s.
const BOOT_TICK_DELAY = 90 * 1000;

let intervalHandle = null;
let bootTimeoutHandle = null;
let passInProgress = false;
// Local YYYY-MM-DD of the last pass, so the per-minute tick fires it once a day.
let lastRunDate = null;

async function runPass(reason = 'cron') {
  if (passInProgress) return undefined;
  passInProgress = true;
  try {
    const result = await performAutoEmailPass({
      database: db,
      templatesModel: emailTemplatesModel,
      logModel: emailLogModel,
      settingsModel,
      emailServiceFactory: createEmailService,
    });
    const { blocked, sentCount, skippedCount, failedCount } = result;
    // specs/guest-email-sequence.md rule 17 — the sequence rides the same daily pass. Its own
    // per-template guard runs inside; a failure there must not hide the legacy pass's result.
    if (!blocked) {
      try {
        const sequence = await runSequencePass({
          database: db, ledger: guestEmailSendsModel, templatesModel: emailTemplatesModel, logModel: emailLogModel,
          settingsModel, emailServiceFactory: createEmailService, preferences: emailPreferencesModel,
        });
        if (sequence.sent > 0 || sequence.failed > 0) {
          console.log(`[guest-email-sequence] ${reason}: ${sequence.sent} sent, ${sequence.failed} failed`);
        }
      } catch (err) {
        console.error('[guest-email-sequence] unexpected error:', err);
      }
    }
    if (blocked) {
      // The timer only exists while a template is « auto », so this means the two went out of step —
      // a template written outside the controller, a read that failed closed. Worth a line: it can
      // happen at most once a day, and the tick stops the scheduler right after.
      console.warn(`[email-auto-send] ${reason}: aucun modèle en envoi automatique — passe annulée, planification arrêtée`);
    } else if (sentCount > 0 || failedCount > 0) {
      console.log(`[email-auto-send] ${reason}: ${sentCount} sent, ${skippedCount} skipped, ${failedCount} failed`);
    }
    return result;
  } catch (err) {
    console.error('[email-auto-send] unexpected error:', err);
    return undefined;
  } finally {
    passInProgress = false;
  }
}

/**
 * Per-minute tick. Fires the pass at the first tick on/after 08:00 local time, once per local day,
 * so a server that was down at 08:00 still catches up later the same day.
 *
 * @param {{ now?: Date, run?: (reason: string) => Promise<any> }} deps — injected by the tests.
 */
function tick(deps = {}) {
  const now = deps.now || new Date();
  const run = deps.run || runPass;
  if (now.getHours() < 8) return undefined;
  const today = isoToday(now);
  if (lastRunDate === today) return undefined;
  const previous = lastRunDate;
  // Claim the day's slot up-front so a slow pass can't be started twice by the next tick.
  lastRunDate = today;
  return Promise.resolve()
    .then(() => run('daily 08:00 pass'))
    .then((result) => {
      if (!result || !result.blocked) return;
      // Give the slot back before shutting down: switching a template to « auto » later the same day
      // must run today's pass, not wait for tomorrow 08:00 by which point today's templates no longer
      // match.
      lastRunDate = previous;
      stop();
    })
    .catch((err) => console.error('[email-auto-send] unhandled:', err));
}

function isRunning() {
  return intervalHandle !== null;
}

/**
 * Registers the per-minute tick. No-op when it is already running.
 * @param {{ boot?: boolean, now?: Date, run?: Function }} deps — `boot` delays the first tick by
 *   90 s (startup breathing room); any other start runs it immediately, because the operator just
 *   switched a template to « auto » and expects today's mail to leave today.
 * @returns {boolean} true when this call started the timer.
 */
function start(deps = {}) {
  if (intervalHandle) return false;
  intervalHandle = setInterval(() => tick(deps), TICK_INTERVAL);
  console.log('[email-auto-send] envoi automatique activé — passe quotidienne planifiée à 08:00');
  if (deps.boot) bootTimeoutHandle = setTimeout(() => tick(deps), BOOT_TICK_DELAY);
  else tick(deps);
  return true;
}

/**
 * Clears the timer. No-op when nothing is scheduled.
 * @returns {boolean} true when this call stopped a running timer.
 */
function stop() {
  if (bootTimeoutHandle) {
    clearTimeout(bootTimeoutHandle);
    bootTimeoutHandle = null;
  }
  if (!intervalHandle) return false;
  clearInterval(intervalHandle);
  intervalHandle = null;
  console.log('[email-auto-send] envoi automatique désactivé — aucune passe planifiée');
  return true;
}

/**
 * Aligns the timer with the templates. The single entry point for boot and for a template write.
 * @param {{ boot?: boolean, templatesModel?: object, now?: Date, run?: Function }} deps
 * @returns {boolean} true when the call changed the timer's state.
 */
function syncWithTemplates(deps = {}) {
  const model = deps.templatesModel || emailTemplatesModel;
  return anyTemplateAutoSends(model) ? start(deps) : stop();
}

module.exports = {
  syncWithTemplates,
  start,
  stop,
  isRunning,
  // Exposed for tests + an ops trigger.
  runPass,
  tick,
};
