/**
 * Vacances scolaires (specs/school-holidays.md; module per specs/plugins-phase-1-sdk.md).
 * The official A/B/C periods from education.gouv, synced every 60 days (hourly check), editable and
 * lockable by hand, drawn as zone bands in the calendars.
 */

const { create: createModel } = require('./model');
const { runSync } = require('./sync');
const { createController } = require('./controller');
const { buildRouter } = require('./routes');

const id = 'school-holidays';
const HOUR = 60 * 60 * 1000;

function register(ctx) {
  ctx.migrations([{
    name: 'tables_v1',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS school_holidays (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          label TEXT NOT NULL,
          zoneA_start TEXT,
          zoneA_end TEXT,
          zoneB_start TEXT,
          zoneB_end TEXT,
          zoneC_start TEXT,
          zoneC_end TEXT
        )
      `);
      // Databases older than the auto-sync (specs/school-holidays.md §5) lack these columns.
      const cols = db.prepare('PRAGMA table_info(school_holidays)').all().map((c) => c.name);
      if (!cols.includes('externalRef')) db.exec('ALTER TABLE school_holidays ADD COLUMN externalRef TEXT');
      if (!cols.includes('isLocked')) db.exec('ALTER TABLE school_holidays ADD COLUMN isLocked INTEGER NOT NULL DEFAULT 0');
      if (!cols.includes('lastSyncedAt')) db.exec('ALTER TABLE school_holidays ADD COLUMN lastSyncedAt TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_school_holidays_externalRef ON school_holidays (externalRef)');
      db.exec(`
        CREATE TABLE IF NOT EXISTS school_holidays_sync_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          syncIntervalDays INTEGER NOT NULL DEFAULT 60,
          syncHorizonMonths INTEGER NOT NULL DEFAULT 24,
          lastSyncAt TEXT,
          lastSyncStatus TEXT DEFAULT 'never',
          lastSyncMessage TEXT DEFAULT '',
          lastImportedCount INTEGER DEFAULT 0,
          updatedAt TEXT DEFAULT (datetime('now'))
        )
      `);
      db.prepare('INSERT OR IGNORE INTO school_holidays_sync_state (id) VALUES (1)').run();
    },
  }]);

  // Built on first use: on a database where the plugin is not installed its tables do not exist,
  // and preparing a statement against them at register time would fail.
  let model = null;
  const getModel = () => {
    if (!model) model = createModel(ctx.db);
    return model;
  };
  const lazyModel = new Proxy({}, { get: (_, key) => getModel()[key] });

  let inProgress = false;
  async function performSync(reason) {
    if (inProgress) return { ok: false, error: 'Synchronisation déjà en cours.' };
    inProgress = true;
    try {
      const m = getModel();
      const result = await runSync({ model: m, fetchFn: fetch, horizonMonths: m.getSyncState().syncHorizonMonths });
      if (result.ok) {
        ctx.log.info(`Sync (${reason}) OK : ${result.createdCount} créé(s), ${result.updatedCount} mis à jour, ${result.skippedLockedCount} verrouillé(s), ${result.deletedStaleCount} supprimé(s) en ${result.durationMs} ms.`);
      } else {
        ctx.log.error(`Sync (${reason}) en erreur : ${result.error}`);
      }
      return result;
    } finally {
      inProgress = false;
    }
  }

  // Fixed cadence (specs/settings-rationalization.md rule 13): due when 60 days have passed.
  function isDue() {
    const state = getModel().getSyncState();
    if (!state.lastSyncAt) return true;
    const lastMs = Date.parse(state.lastSyncAt);
    if (Number.isNaN(lastMs)) return true;
    return Date.now() - lastMs >= state.syncIntervalDays * 24 * HOUR;
  }

  const controller = createController({
    model: lazyModel,
    sentenceCase: (s) => ctx.core.text.sentenceCase(s),
    sync: () => performSync('manual'),
  });
  ctx.mount('/api/school-holidays', buildRouter(controller));

  ctx.jobs.every({
    name: 'sync',
    intervalMs: HOUR,
    bootDelayMs: 60 * 1000,
    run: async () => { if (isDue()) await performSync('scheduled'); },
  });

  // Rule 26 — a fresh install fetches the official periods at once.
  ctx.onInstall(() => performSync('install'));

  ctx.data({
    tables: ['school_holidays', 'school_holidays_sync_state'],
    // The cached statements point at the dropped tables; a reinstall prepares new ones.
    purge: () => { model = null; },
    describe: (db) => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM school_holidays').get().n;
      const lines = [];
      if (n > 0) lines.push({ label: n > 1 ? `${n} périodes de vacances` : '1 période de vacances', count: n });
      lines.push({ label: 'l’état de synchronisation', count: 1 });
      return lines;
    },
  });
}

module.exports = { id, register };
