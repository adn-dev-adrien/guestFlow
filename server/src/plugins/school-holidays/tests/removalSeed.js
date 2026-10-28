// specs/plugin-removal-resilience.md rule 11 — a school holiday and the sync state.
module.exports = {
  seed(db) {
    db.prepare(`INSERT INTO school_holidays (label, zoneA_start, zoneA_end, zoneB_start, zoneB_end, zoneC_start, zoneC_end)
      VALUES ('Vacances de test', '2030-02-09', '2030-02-24', '2030-02-16', '2030-03-03', '2030-02-23', '2030-03-10')`).run();
    db.prepare("INSERT OR REPLACE INTO school_holidays_sync_state (id, lastSyncAt, lastSyncStatus) VALUES (1, datetime('now'), 'ok')").run();
  },
};
