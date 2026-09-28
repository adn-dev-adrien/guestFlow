const db = require('./database');

// Canonical anti-overbooking sync engine (+ source status recording) lives in the iCal model.
const propertyIcalModel = require('./models/propertyIcalModel');
const icalExportRangesModel = require('./models/icalExportRangesModel');


// Email automation (specs/email-automation.md §3 rule 7). The 08:00 auto-send pass owns its own
// timer, registered only while automatic sending is authorised
// (specs/no-automatic-email-without-approval.md §3 rule 2b).
const emailAutoSendScheduler = require('./utils/emailAutoSendScheduler');
const emailLogModel       = require('./models/emailLogModel');
const settingsModel       = require('./models/settingsModel');
const { isoToday } = require('./utils/emailAutoSendRunner');

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
const { withQonto } = require('./utils/qontoService');
const { runPaymentPoll } = require('./utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('./utils/paymentEffectDeps');
const { resolvePaymentPollTickMs } = require('./utils/paymentPollSchedule');
const { ensureWebhookSubscription } = require('./utils/qontoWebhookRegistrar');

const { whenPluginActive } = require('./utils/pluginScheduling');
const PLUGINS = require('./constants/plugins');

// Self-update version check (specs/self-update-and-releases.md §3.B rule 12).
const systemController = require('./controllers/systemController');

let syncInProgress = false;
let arrivalDeparturePushInProgress = false;
// First pass after boot stamps already-due events WITHOUT sending (no restart flood — rule 12).
let arrivalDeparturePushFirstRun = true;
// Once-per-day guard for the email-history rolling-window purge.
let lastEmailHistoryPurgeDate = null;

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

    // specs/lodgify-decommission.md §3 rule 7 — tombstones only matter for 72 h; keep a week.
    icalExportRangesModel.purge();
  } catch (error) {
    console.error('[iCal Sync] Erreur critique:', error);
  } finally {
    syncInProgress = false;
  }
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
    // The webhook is the paid signal; this pass is the safety net behind it. Making sure the
    // subscription exists is therefore part of the safety net, not a separate chore
    // (specs/settings-one-save-and-automatic-webhook.md rule 11). It costs no Qonto call once the
    // subscription is recorded (rule 10), and it never throws.
    await ensureWebhookSubscription({ settings: settingsModel });
    // Through `withQonto` so a broken connection is recorded and shown in Réglages → Paiements
    // instead of failing silently every pass (specs/qonto-settings-in-app.md rule 12).
    const summary = await withQonto({ settings: settingsModel, origin: 'poll' }, (client, accessToken) => runPaymentPoll({
      ...buildPaymentEffectDeps(),
      qontoClient: client,
      getAccessToken: () => accessToken,
    }));
    if (summary.retired > 0) console.log(`[payments] ${reason}: ${summary.retired} expired link(s) retired without a Qonto call`);
    if (summary.stoppedBy) console.warn(`[payments] ${reason}: pass stopped by ${summary.stoppedBy} after ${summary.checked} link(s); the rest wait for the next tick`);
    if (summary.paid > 0) {
      console.log(`[payments] ${reason}: ${summary.paid} paid / ${summary.checked} checked`);
      // A paid link may just have flipped an insured reservation's acompte — subscribe now, not
      // at the next Neat tick (specs/neat-cancellation-insurance-subscription.md rule 8).
      require('./controllers/neatController').kickPass('payment-poll');
    }
  } catch (err) {
    console.error('[payments] poll pass error:', err && err.message ? err.message : err);
  } finally {
    paymentPollInProgress = false;
  }
}

// Neat cancellation-insurance subscriptions (specs/neat-cancellation-insurance-subscription.md
// §3.2 rule 8): scan insured + deposit-paid reservations, subscribe due jobs, retry failures.
// The controller owns the pass (re-entrancy guard + real deps) and bails silently while the
// integration is unconfigured; the payment flows kick the same pass so the nominal case
// subscribes within seconds of the acompte, this tick being the safety net.
async function runNeatSubscriptionPass(reason = 'cron') {
  try {
    await require('./controllers/neatController').runPass(reason);
  } catch (err) {
    console.error('[neat] pass error:', err && err.message ? err.message : err);
  }
}

// No money pass here, on purpose (specs/payment-schedule-and-cancellation.md §1 amendment, rule 44).
// A daily job used to mint the solde link and mail the request at J-30; the operator now sends every
// money email himself from the dashboard's « Échéances de paiement » card, which lists the same
// reservations. The passes that remain send stay information, never a euro request.

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

  // Email auto-send: no timer at all unless a template is « auto ». Switching one to « auto » in Emails
  // starts it (and runs the day's pass) without a restart — the scheduler is re-synced by
  // emailTemplatesController on every write (specs/settings-rationalization.md rule 17b).
  emailAutoSendScheduler.syncWithTemplates({ boot: true });

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

  // Online-payment polling: three passes a day (specs/payment-polling-fair-use.md rule 11). The
  // webhook confirms in real time and the guest's success page reconciles on demand; this is the
  // net that catches a webhook that never arrived.
  const PAYMENT_POLL_TICK = resolvePaymentPollTickMs();
  // Every plugin pass below skips its tick while its plugin is inactive
  // (specs/plugins-phase-0-foundation.md rule 15).
  const paymentPoll = whenPluginActive(PLUGINS.ONLINE_PAYMENT, runPaymentPollPass);
  setInterval(() => paymentPoll('cron').catch((err) => console.error('[payments] unhandled:', err)), PAYMENT_POLL_TICK);
  setTimeout(() => paymentPoll('boot').catch((err) => console.error('[payments] unhandled:', err)), 110 * 1000);

  // Neat subscriptions: every 5 min (the payment flows kick the pass for the nominal case; this
  // tick is the retry ladder + the safety net). Boot pass 150 s after start.
  const NEAT_TICK = 5 * 60 * 1000;
  const neatPass = whenPluginActive(PLUGINS.NEAT, runNeatSubscriptionPass);
  setInterval(() => neatPass('cron').catch((err) => console.error('[neat] unhandled:', err)), NEAT_TICK);
  setTimeout(() => neatPass('boot').catch((err) => console.error('[neat] unhandled:', err)), 150 * 1000);

  // Self-update: poll the GitHub releases API hourly, plus once 60 s after boot so a restart
  // surfaces a pending version straight away (specs/self-update-and-releases.md §3.B rule 12).
  // `runVersionCheck` never rejects — an unreachable GitHub leaves the last known state in place.
  const UPDATE_CHECK_TICK = 60 * 60 * 1000;
  setInterval(() => { systemController.runVersionCheck().catch(() => {}); }, UPDATE_CHECK_TICK);
  setTimeout(() => { systemController.runVersionCheck().catch(() => {}); }, 60 * 1000);
}

module.exports = {
  startScheduledTasks,
  performAutoSync,
  // Arrival/departure push — exposed for tests + ops trigger.
  runArrivalDeparturePushPass,
  // Breakfast push — exposed for tests + ops trigger.
  runBreakfastPushPass,
  // Neat subscription pass — exposed for tests + ops trigger.
  runNeatSubscriptionPass,
};
