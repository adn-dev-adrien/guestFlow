const db = require('./database');

// Canonical anti-overbooking sync engine (+ source status recording) lives in the iCal model.
const propertyIcalModel = require('./models/propertyIcalModel');
const icalExportRangesModel = require('./models/icalExportRangesModel');


// Email automation (specs/email-automation.md §3 rule 7). The 08:00 auto-send pass owns its own
// timer, registered only while automatic sending is authorised
// (specs/no-automatic-email-without-approval.md §3 rule 2b).
const emailAutoSendScheduler = require('./utils/emailAutoSendScheduler');
const emailLogModel       = require('./models/emailLogModel');
const { isoToday } = require('./utils/emailAutoSendRunner');

// Arrival/departure push (specs/pwa-push-notifications.md §3.3).
const reservationsModel = require('./models/reservationsModel');
const pushService = require('./utils/pushService');
const { runArrivalDeparturePush } = require('./utils/arrivalDeparturePushRunner');
// Breakfast serving-time push (specs/sas-breakfast-bread-and-push.md §3 rules 7-9).
const { runBreakfastPush } = require('./utils/breakfastPushRunner');
const breakfastModel = require('./models/breakfastModel');

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
};
