const db = require('./database');

// Canonical anti-overbooking sync engine (+ source status recording) lives in the iCal model.
const propertyIcalModel = require('./models/propertyIcalModel');

// School holidays auto-sync (spec school-holidays §3 rules 15+).
const schoolHolidaysModel = require('./models/schoolHolidaysModel');
const { runSync: runSchoolHolidaysSync } = require('./utils/schoolHolidaysSync');

let syncInProgress = false;
let schoolHolidaysSyncInProgress = false;

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
}

module.exports = {
  startScheduledTasks,
  performAutoSync,
  performSchoolHolidaysSync,
  shouldSyncSchoolHolidays,
};
