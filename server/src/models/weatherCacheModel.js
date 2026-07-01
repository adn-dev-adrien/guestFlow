/**
 * Weather vigilance cache model — sole DB access for `weather_vigilance_cache`
 * (specs/checkin-weather-alerts.md §4.1). One row per département: the normalized phenomena payload
 * (JSON) + the fetch timestamp. Durable across restarts so opening several check-ins in a row
 * reuses a fresh cache instead of hammering the Météo-France API.
 *
 * Exports a default model bound to the production DB + a `buildModel(db)` factory for tests.
 *
 * API:
 *   read(dept)                     → { payload, fetchedAt } | null   (payload = parsed array)
 *   readFresh(dept, ttlMin, nowMs) → same shape, but null when older than ttlMin
 *   upsert(dept, payload, nowMs)   → stores JSON.stringify(payload) + ISO(nowMs)
 */

function buildModel(database) {
  const readStmt = database.prepare(
    'SELECT departmentCode, payload, fetchedAt FROM weather_vigilance_cache WHERE departmentCode = ?'
  );
  const upsertStmt = database.prepare(`
    INSERT INTO weather_vigilance_cache (departmentCode, payload, fetchedAt)
    VALUES (@departmentCode, @payload, @fetchedAt)
    ON CONFLICT(departmentCode) DO UPDATE SET payload = excluded.payload, fetchedAt = excluded.fetchedAt
  `);

  function read(departmentCode) {
    const row = readStmt.get(String(departmentCode || '').trim().toUpperCase());
    if (!row) return null;
    let payload = [];
    try { payload = JSON.parse(row.payload); } catch { payload = []; }
    if (!Array.isArray(payload)) payload = [];
    return { payload, fetchedAt: row.fetchedAt };
  }

  function readFresh(departmentCode, ttlMinutes, nowMs = Date.now()) {
    const entry = read(departmentCode);
    if (!entry) return null;
    const fetchedMs = new Date(entry.fetchedAt).getTime();
    if (Number.isNaN(fetchedMs)) return null;
    if (nowMs - fetchedMs > Number(ttlMinutes) * 60 * 1000) return null;
    return entry;
  }

  function upsert(departmentCode, payload, nowMs = Date.now()) {
    upsertStmt.run({
      departmentCode: String(departmentCode || '').trim().toUpperCase(),
      payload: JSON.stringify(Array.isArray(payload) ? payload : []),
      fetchedAt: new Date(nowMs).toISOString(),
    });
  }

  return { read, readFresh, upsert };
}

const defaultModel = (() => {
  try { return buildModel(require('../database')); } catch { return null; }
})();

if (defaultModel) {
  defaultModel.buildModel = buildModel;
  module.exports = defaultModel;
} else {
  module.exports = { buildModel };
}
