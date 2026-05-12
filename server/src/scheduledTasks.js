const db = require('./database');

// Reuse the canonical sync engine implemented in routes/properties.
const propertiesRouter = require('./routes/properties');

let syncInProgress = false;

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
        const result = await propertiesRouter.syncIcalSource(source);

        // Update source metadata
        db.prepare(`
          UPDATE ical_sources
          SET lastSyncAt = datetime('now'),
              lastSyncStatus = 'success',
              lastSyncMessage = ?,
              lastImportedCount = ?,
              updatedAt = datetime('now')
          WHERE id = ?
        `).run(
          `${result.createdCount} créé(s), ${result.updatedCount} mis à jour, ${result.lockedCount} verrouillé(s), ${result.removedCount} supprimé(s), ${result.unchangedCount} inchangé(s)`,
          result.createdCount + result.updatedCount,
          source.id
        );

        totalCreated += result.createdCount;
        totalUpdated += result.updatedCount;
        totalRemoved += result.removedCount;

      } catch (error) {
        totalErrors += 1;
        console.error(`[iCal Sync] ❌ Erreur lors de la synchronisation de "${source.name}":`, error.message);

        db.prepare(`
          UPDATE ical_sources
          SET lastSyncAt = datetime('now'),
              lastSyncStatus = 'error',
              lastSyncMessage = ?,
              updatedAt = datetime('now')
          WHERE id = ?
        `).run(String(error.message || 'Erreur de synchronisation iCal'), source.id);
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
}

module.exports = {
  startScheduledTasks,
  performAutoSync,
};
