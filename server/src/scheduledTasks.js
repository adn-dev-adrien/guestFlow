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

let syncInProgress = false;
let schoolHolidaysSyncInProgress = false;
let emailAutoSendInProgress = false;
// Track the local-date YYYY-MM-DD of the last successful auto-email run so the per-minute
// tick doesn't fire the pass more than once per day.
let lastEmailAutoSendDate = null;

async function performAutoSync() {
  if (syncInProgress) {
    return;
  }

  syncInProgress = true;
  const startTime = new Date();

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

    let totalCreated = 0;
    let totalUpdated = 0;
    let totalRemoved = 0;
    let totalErrors = 0;

    // Sync each source
    for (const source of sources) {
      try {
        // syncSourceAndRecord runs the sync engine + writes the source status row.
        const result = await propertyIcalModel.syncSourceAndRecord(source);
        totalCreated += result.createdCount;
        totalUpdated += result.updatedCount;
        totalRemoved += result.removedCount;
      } catch (error) {
        totalErrors += 1;
        console.error(`[iCal Sync] ❌ Erreur lors de la synchronisation de "${source.name}":`, error.message);
      }
    }

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
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
}

module.exports = {
  startScheduledTasks,
  performAutoSync,
  performSchoolHolidaysSync,
  shouldSyncSchoolHolidays,
  // Email automation — exposed for tests + ops trigger.
  runEmailAutoSendPass,
  tickEmailAutoSend,
};
