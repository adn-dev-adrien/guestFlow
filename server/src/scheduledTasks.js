const db = require('./database');

// Canonical anti-overbooking sync engine (+ source status recording) lives in the iCal model.
const propertyIcalModel = require('./models/propertyIcalModel');

// School holidays auto-sync (spec school-holidays §3 rules 15+).
const schoolHolidaysModel = require('./models/schoolHolidaysModel');
const { runSync: runSchoolHolidaysSync } = require('./utils/schoolHolidaysSync');

// Email automation auto-send (specs/email-automation.md §3 rule 7).
const emailTemplatesModel = require('./models/emailTemplatesModel');
const emailLogModel       = require('./models/emailLogModel');
const settingsModel       = require('./models/settingsModel');
const { createEmailService } = require('./utils/emailService');
const { performAutoEmailPass, isoToday } = require('./utils/emailAutoSendRunner');

// Arrival/departure push (specs/pwa-push-notifications.md §3.3).
const reservationsModel = require('./models/reservationsModel');
const pushService = require('./utils/pushService');
const { runArrivalDeparturePush } = require('./utils/arrivalDeparturePushRunner');
// Breakfast serving-time push (specs/sas-breakfast-bread-and-push.md §3 rules 7-9).
const { runBreakfastPush } = require('./utils/breakfastPushRunner');
const breakfastModel = require('./models/breakfastModel');

// Online-payment polling (specs/online-payments-qonto.md §3.3): detect paid Qonto links → convert.
const paymentLinksModel = require('./models/paymentLinksModel');
const devisModel = require('./models/devisModel');
const { buildQontoClient } = require('./utils/qontoClient');
const { getValidQontoAccessToken } = require('./utils/qontoAuth');
const { runPaymentPoll } = require('./utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('./utils/paymentEffectDeps');
// Balance-request daily pass (specs/public-online-deposit.md §3 rule 8).
const { runBalanceRequestPass } = require('./utils/balanceRequestRunner');
const paymentsController = require('./controllers/paymentsController');

// Google Calendar reconcile pass (specs/google-calendar-oauth-rework.md §3 rule 22).
const googleCalendarSync = require('./utils/googleCalendarSync');

let syncInProgress = false;
let schoolHolidaysSyncInProgress = false;
let emailAutoSendInProgress = false;
let arrivalDeparturePushInProgress = false;
// First pass after boot stamps already-due events WITHOUT sending (no restart flood — rule 12).
let arrivalDeparturePushFirstRun = true;
// Track the local-date YYYY-MM-DD of the last successful auto-email run so the per-minute
// tick doesn't fire the pass more than once per day.
let lastEmailAutoSendDate = null;
// Same once-per-day guard for the email-history rolling-window purge.
let lastEmailHistoryPurgeDate = null;
// Once-per-day guard for the balance-request pass (online-deposit solde).
let lastBalanceRequestDate = null;
let balanceRequestInProgress = false;

async function performAutoSync() {
  if (syncInProgress) {
    return;
  }

  syncInProgress = true;

  try {
    // Get all active iCal sources
    const sources = db.prepare(`
      SELECT * FROM ical_sources
      WHERE isActive = 1
      ORDER BY id
    `).all();

    if (!sources.length) {
      syncInProgress = false;
      return;
    }

    // Sync each source. syncSourceAndRecord runs the sync engine, writes the source status
    // row, and triggers the Google Calendar reconcile itself when bookings changed.
    for (const source of sources) {
      try {
        await propertyIcalModel.syncSourceAndRecord(source);
      } catch (error) {
        console.error(`[iCal Sync] ❌ Erreur lors de la synchronisation de "${source.name}":`, error.message);
      }
    }

  } catch (error) {
    console.error('[iCal Sync] Erreur critique:', error);
  } finally {
    syncInProgress = false;
  }
}

async function performSchoolHolidaysSync(reason = 'scheduled') {
  if (schoolHolidaysSyncInProgress) return;
  schoolHolidaysSyncInProgress = true;
  try {
    const state = schoolHolidaysModel.getSyncState();
    const result = await runSchoolHolidaysSync({
      model: schoolHolidaysModel,
      fetchFn: fetch,
      horizonMonths: state.syncHorizonMonths,
    });
    if (result.ok) {
      console.log(`[Vacances scolaires] Sync (${reason}) OK : ${result.createdCount} créé(s), ${result.updatedCount} mis à jour, ${result.skippedLockedCount} verrouillé(s), ${result.deletedStaleCount} supprimé(s) en ${result.durationMs} ms.`);
    } else {
      console.error(`[Vacances scolaires] Sync (${reason}) en erreur : ${result.error}`);
    }
  } catch (err) {
    console.error('[Vacances scolaires] Sync : exception inattendue :', err);
  } finally {
    schoolHolidaysSyncInProgress = false;
  }
}

function shouldSyncSchoolHolidays() {
  const state = schoolHolidaysModel.getSyncState();
  if (!state.lastSyncAt) return true;
  const lastMs = Date.parse(state.lastSyncAt);
  if (Number.isNaN(lastMs)) return true;
  const elapsedMs = Date.now() - lastMs;
  return elapsedMs >= state.syncIntervalDays * 24 * 60 * 60 * 1000;
}

function tickSchoolHolidaysSync(reason) {
  if (shouldSyncSchoolHolidays()) {
    performSchoolHolidaysSync(reason).catch(err => console.error('[Vacances scolaires] Erreur non gérée:', err));
  }
}

async function runEmailAutoSendPass(reason = 'cron') {
  if (emailAutoSendInProgress) return;
  emailAutoSendInProgress = true;
  try {
    const { sentCount, skippedCount, failedCount } = await performAutoEmailPass({
      database: db,
      templatesModel: emailTemplatesModel,
      logModel: emailLogModel,
      settingsModel,
      emailServiceFactory: createEmailService,
    });
    if (sentCount > 0 || failedCount > 0) {
      console.log(`[email-auto-send] ${reason}: ${sentCount} sent, ${skippedCount} skipped, ${failedCount} failed`);
    }
  } catch (err) {
    console.error('[email-auto-send] unexpected error:', err);
  } finally {
    emailAutoSendInProgress = false;
  }
}

// Per-minute tick. Fires the auto-send pass at the first tick on/after 08:00 local time,
// once per local day. Catches up if the server was down at 08:00 (any later tick on the
// same day triggers the pass as long as it hasn't already run).
function tickEmailAutoSend() {
  const now = new Date();
  const hour = now.getHours();
  if (hour < 8) return;
  const today = isoToday(now);
  if (lastEmailAutoSendDate === today) return;
  lastEmailAutoSendDate = today;
  runEmailAutoSendPass('daily 08:00 pass').catch((err) => console.error('[email-auto-send] unhandled:', err));
}

// Email-history rolling-window purge (specs/email-history-rolling-window.md §3 rule 3). Deletes log rows
// for reservations past arrival + retention (and orphans). Synchronous (better-sqlite3) + idempotent.
function runEmailHistoryPurge(reason = 'cron') {
  try {
    const removed = emailLogModel.purgeRealizedStays();
    if (removed > 0) console.log(`[email-history-purge] ${reason}: removed ${removed} past-stay log row(s)`);
  } catch (err) {
    console.error('[email-history-purge] error:', err && err.message ? err.message : err);
  }
}

// Hourly tick, once-per-local-day guard (the window only moves day-by-day).
function tickEmailHistoryPurge() {
  const today = isoToday(new Date());
  if (lastEmailHistoryPurgeDate === today) return;
  lastEmailHistoryPurgeDate = today;
  runEmailHistoryPurge('daily pass');
}

// Per-minute arrival/departure push pass. Isolated from the other jobs (its own in-progress guard +
// try/catch). The first pass after boot stamps already-due events without sending (rule 12).
async function runArrivalDeparturePushPass(reason = 'tick') {
  if (arrivalDeparturePushInProgress) return;
  arrivalDeparturePushInProgress = true;
  const firstRun = arrivalDeparturePushFirstRun;
  arrivalDeparturePushFirstRun = false;
  try {
    const { sent, stamped } = await runArrivalDeparturePush({ reservationsModel, pushService, firstRun });
    if (sent > 0) console.log(`[push] ${reason}: ${sent} arrival/departure push(es) sent (${stamped} stamped)`);
  } catch (err) {
    console.error('[push] arrival/departure pass error:', err && err.message ? err.message : err);
  } finally {
    arrivalDeparturePushInProgress = false;
  }
}

// Per-minute breakfast push pass (specs/sas-breakfast-bread-and-push.md rules 7-8): notify
// `lead` minutes before each breakfast's serving time; first pass after boot stamps without sending.
let breakfastPushInProgress = false;
let breakfastPushFirstRun = true;
async function runBreakfastPushPass(reason = 'tick') {
  if (breakfastPushInProgress) return;
  breakfastPushInProgress = true;
  const firstRun = breakfastPushFirstRun;
  breakfastPushFirstRun = false;
  try {
    const { sent, stamped } = await runBreakfastPush({ breakfastModel, reservationsModel, pushService, firstRun });
    if (sent > 0) console.log(`[push] ${reason}: ${sent} breakfast push(es) sent (${stamped} stamped)`);
  } catch (err) {
    console.error('[push] breakfast pass error:', err && err.message ? err.message : err);
  } finally {
    breakfastPushInProgress = false;
  }
}

// Online payments: poll open Qonto links → mark paid → convert devis / flag deposit. Skips silently
// when Qonto isn't connected (no token) so it's a no-op until the operator connects.
let paymentPollInProgress = false;
async function runPaymentPollPass(reason = 'cron') {
  if (paymentPollInProgress) return;
  if (!settingsModel.qontoConnected || !settingsModel.qontoConnected()) return;
  paymentPollInProgress = true;
  try {
    const summary = await runPaymentPoll({
      ...buildPaymentEffectDeps(),
      qontoClient: buildQontoClient(),
      getAccessToken: () => getValidQontoAccessToken({ settings: settingsModel, clientFactory: buildQontoClient }),
    });
    if (summary.paid > 0) console.log(`[payments] ${reason}: ${summary.paid} paid / ${summary.checked} checked`);
  } catch (err) {
    console.error('[payments] poll pass error:', err && err.message ? err.message : err);
  } finally {
    paymentPollInProgress = false;
  }
}

// Balance-request daily pass: create/reuse the balance link + email the balance_request template for
// reservations whose deposit was collected online but whose solde is now due. Skips silently when Qonto
// isn't connected (the sender can't mint links) — retried the next day.
async function runBalanceRequestJob(reason = 'daily') {
  if (balanceRequestInProgress) return;
  if (!settingsModel.qontoConnected || !settingsModel.qontoConnected()) return;
  balanceRequestInProgress = true;
  try {
    const summary = await runBalanceRequestPass({
      database: db,
      templatesModel: emailTemplatesModel,
      logModel: emailLogModel,
      sendBalanceRequest: (id) => paymentsController.sendBalanceRequestFor(id),
    });
    if (summary.sent > 0) console.log(`[balance-request] ${reason}: ${summary.sent} sent / ${summary.checked} eligible`);
  } catch (err) {
    console.error('[balance-request] pass error:', err && err.message ? err.message : err);
  } finally {
    balanceRequestInProgress = false;
  }
}

// Per-minute tick, gated ≥ 08:00 local, once per local day (same shape as the auto-email tick).
function tickBalanceRequest() {
  const now = new Date();
  if (now.getHours() < 8) return;
  const today = isoToday(now);
  if (lastBalanceRequestDate === today) return;
  lastBalanceRequestDate = today;
  runBalanceRequestJob('daily 08:00 pass').catch((err) => console.error('[balance-request] unhandled:', err));
}

// Google Calendar reconcile: overlap-guarded inside the sync engine (runReconcileGuarded);
// silent no-op until the operator connects a Google account + picks a calendar.
async function runGoogleSyncPass(reason = 'cron') {
  if (!googleCalendarSync.isActive()) return;
  try {
    const result = await googleCalendarSync.runReconcileGuarded();
    if (result && !result.alreadyRunning && (result.pushed || result.deleted || result.errors)) {
      console.log(`[google-sync] ${reason}: ${result.pushed} pushed, ${result.deleted} deleted, ${result.skipped} unchanged, ${result.errors} error(s)`);
    }
  } catch (err) {
    console.error('[google-sync] pass error:', err && err.message ? err.message : err);
  }
}

// Tariff-recipe horizon extension (specs/tariff-recipes/spec.md §3.2 rule 12). For every property
// with an active recipe: when the horizon (current year + recipe.horizonYears − 1) is no longer
// fully covered by its recipe-owned seasons, re-apply the recipe (idempotent — a covered horizon
// produces an empty diff and writes nothing) and journal the run so the Dashboard surfaces it.
// A blocking condition journals instead of writing — the operator is told, never silently left
// with a half-configured year. One pending journal row per property max (no daily spam).
function runTariffRecipeHorizonPass(reason = 'cron', deps = {}) {
  let model; let store; let database;
  try {
    model = deps.model || require('./models/tariffRecipeModel').getDefaultModel();
    store = deps.store || require('./utils/tariffRecipe').getDefaultStore();
    database = deps.database || db;
  } catch (err) {
    console.error('[tariff-recipes] init error:', err && err.message ? err.message : err);
    return;
  }
  const properties = database.prepare("SELECT id, name, tariffRecipeId FROM properties WHERE tariffRecipeId != ''").all();
  if (!properties.length) return;
  const pendingByProperty = new Set(model.listPendingRuns().map((run) => run.propertyId));
  const currentYear = new Date().getFullYear();

  for (const property of properties) {
    try {
      if (pendingByProperty.has(property.id)) continue; // an undismissed alert is already waiting
      const recipe = store.getRecipe(property.tariffRecipeId);
      if (!recipe) {
        model.recordRun({
          propertyId: property.id, recipeId: property.tariffRecipeId, recipeVersion: '',
          note: 'Recette introuvable — le calendrier ne sera plus étendu.', blocking: 1,
        });
        continue;
      }
      const targetYear = currentYear + recipe.horizonYears - 1;
      const covered = model.coveredUntilYear(property.id);
      if (covered !== null && covered >= targetYear) continue; // horizon fully covered → no-op

      const result = model.apply(property.id, property.tariffRecipeId);
      if (result.applied) {
        model.recordRun({
          propertyId: property.id, recipeId: recipe.id, recipeVersion: recipe.version,
          generatedYear: targetYear, note: `Saisons générées jusqu'à fin ${targetYear} — à relire.`,
        });
        console.log(`[tariff-recipes] ${reason}: horizon étendu jusqu'à ${targetYear} pour « ${property.name} »`);
      } else if (result.blocking) {
        model.recordRun({
          propertyId: property.id, recipeId: recipe.id, recipeVersion: recipe.version,
          note: `Extension impossible : ${result.warnings.join(' ') || 'conflit'}`, blocking: 1,
        });
        console.warn(`[tariff-recipes] ${reason}: extension bloquée pour « ${property.name} »`);
      }
    } catch (err) {
      console.error(`[tariff-recipes] pass error (« ${property.name} »):`, err && err.message ? err.message : err);
    }
  }
}

function startScheduledTasks() {
  // Sync iCal sources every 5 minutes (300000 ms)
  const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

  setInterval(() => {
    performAutoSync().catch(err => console.error('[iCal Sync] Erreur non gérée:', err));
  }, SYNC_INTERVAL);

  // Run first sync after 30 seconds to avoid congestion on startup
  setTimeout(() => {
    performAutoSync().catch(err => console.error('[iCal Sync] Erreur lors de la première synchro:', err));
  }, 30000);

  // School holidays: hourly tick that checks the configured interval and triggers a sync if due.
  // Reads fresh state every tick so config changes (PUT /sync-settings) take effect without restart.
  const SCHOOL_HOLIDAYS_TICK = 60 * 60 * 1000; // 1 hour
  setInterval(() => tickSchoolHolidaysSync('hourly tick'), SCHOOL_HOLIDAYS_TICK);
  setTimeout(() => tickSchoolHolidaysSync('boot'), 60 * 1000);

  // Email automation: per-minute tick gated on local-hour >= 8 + once-per-day guard.
  // First tick scheduled 90 s after boot so the cron is hot for the first day-of-server-restart.
  const EMAIL_AUTO_SEND_TICK = 60 * 1000;
  setInterval(tickEmailAutoSend, EMAIL_AUTO_SEND_TICK);
  setTimeout(tickEmailAutoSend, 90 * 1000);

  // Email-history purge: hourly tick (once-per-day guard) + a boot pass 100 s after start, so the rolling
  // window is trimmed without waiting a full day after a restart.
  const EMAIL_HISTORY_PURGE_TICK = 60 * 60 * 1000; // 1 hour
  setInterval(tickEmailHistoryPurge, EMAIL_HISTORY_PURGE_TICK);
  setTimeout(tickEmailHistoryPurge, 100 * 1000);

  // Arrival/departure push: per-minute tick. First pass 95 s after boot (firstRun → stamps the day's
  // already-passed events without sending). Then each minute it pushes events as they cross their time.
  const ARRIVAL_DEPARTURE_PUSH_TICK = 60 * 1000;
  setInterval(() => runArrivalDeparturePushPass('tick').catch((err) => console.error('[push] unhandled:', err)), ARRIVAL_DEPARTURE_PUSH_TICK);
  setTimeout(() => runArrivalDeparturePushPass('boot').catch((err) => console.error('[push] unhandled:', err)), 95 * 1000);

  // Breakfast push: per-minute tick, boot pass 105 s after start (firstRun → stamps without sending).
  const BREAKFAST_PUSH_TICK = 60 * 1000;
  setInterval(() => runBreakfastPushPass('tick').catch((err) => console.error('[push] unhandled:', err)), BREAKFAST_PUSH_TICK);
  setTimeout(() => runBreakfastPushPass('boot').catch((err) => console.error('[push] unhandled:', err)), 105 * 1000);

  // Online-payment polling: every 15 min (cheap; the manual "poll now" button covers on-demand checks).
  const PAYMENT_POLL_TICK = 15 * 60 * 1000;
  setInterval(() => runPaymentPollPass('cron').catch((err) => console.error('[payments] unhandled:', err)), PAYMENT_POLL_TICK);
  setTimeout(() => runPaymentPollPass('boot').catch((err) => console.error('[payments] unhandled:', err)), 110 * 1000);

  // Balance-request daily pass: per-minute tick gated ≥ 08:00 + once-per-day guard (online-deposit solde).
  const BALANCE_REQUEST_TICK = 60 * 1000;
  setInterval(tickBalanceRequest, BALANCE_REQUEST_TICK);
  setTimeout(tickBalanceRequest, 120 * 1000);

  // Google Calendar reconcile: every 15 min (immediate pushes cover the realtime path; this
  // pass catches missed hooks + purges orphans — specs/google-calendar-oauth-rework.md §3 rule 22).
  const GOOGLE_SYNC_TICK = 15 * 60 * 1000;
  setInterval(() => runGoogleSyncPass('cron').catch((err) => console.error('[google-sync] unhandled:', err)), GOOGLE_SYNC_TICK);
  setTimeout(() => runGoogleSyncPass('boot').catch((err) => console.error('[google-sync] unhandled:', err)), 130 * 1000);

  // Tariff-recipe horizon: a daily check that acts at most once per missing year (idempotent no-op
  // the rest of the time). Boot pass 140 s after start so a restart never leaves an expiring
  // horizon waiting a full day.
  const TARIFF_RECIPE_TICK = 24 * 60 * 60 * 1000;
  setInterval(() => { try { runTariffRecipeHorizonPass('cron'); } catch (err) { console.error('[tariff-recipes] unhandled:', err); } }, TARIFF_RECIPE_TICK);
  setTimeout(() => { try { runTariffRecipeHorizonPass('boot'); } catch (err) { console.error('[tariff-recipes] unhandled:', err); } }, 140 * 1000);
}

module.exports = {
  startScheduledTasks,
  performAutoSync,
  performSchoolHolidaysSync,
  shouldSyncSchoolHolidays,
  // Tariff-recipe horizon — exposed for tests + ops trigger.
  runTariffRecipeHorizonPass,
  // Email automation — exposed for tests + ops trigger.
  runEmailAutoSendPass,
  tickEmailAutoSend,
  // Arrival/departure push — exposed for tests + ops trigger.
  runArrivalDeparturePushPass,
  // Breakfast push — exposed for tests + ops trigger.
  runBreakfastPushPass,
  // Balance-request pass — exposed for tests + ops trigger.
  runBalanceRequestJob,
  tickBalanceRequest,
  // Google Calendar reconcile pass — exposed for tests + ops trigger.
  runGoogleSyncPass,
};
