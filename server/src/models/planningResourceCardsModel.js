/**
 * Resource-driven planning cards model — per-session cards for the Planning page.
 * Spec: specs/resource-hourly-scheduling.md §3.4.
 *
 * Returns a `{ 'YYYY-MM-DD': { items: [{ reservationId, resourceId, name, clientName, propertyName,
 * date, start, end, done }] } }` map for the requested `[from, to]` window.
 *
 * An hourly-scheduled resource (`resources.showsPlanningCard = 1`) carries its per-reservation sessions
 * on `reservation_resources.sessions` (JSON `[{ date, start, end, done }]`). One card per session whose
 * `date` ∈ `[from, to]`. Mirrors `planningOptionCardsModel.js` (devis excluded — only real reservations).
 */

const { formatTimeShort } = require('../utils/dateFr');

function buildModel(database) {
  const stmt = (() => {
    try {
      return database.prepare(`
        SELECT
          rr.reservationId AS reservationId,
          rr.resourceId AS resourceId,
          rr.sessions AS sessions,
          rs.name AS name,
          COALESCE(cli.firstName, '') AS firstName,
          COALESCE(cli.lastName,  '') AS lastName,
          res.icalOriginalSummary AS icalOriginalSummary,
          COALESCE(prop.name, '') AS propertyName
        FROM reservation_resources rr
        JOIN resources rs ON rs.id = rr.resourceId
        JOIN reservations res ON res.id = rr.reservationId
        LEFT JOIN clients cli ON cli.id = res.clientId
        LEFT JOIN properties prop ON prop.id = res.propertyId
        WHERE rs.showsPlanningCard = 1
          AND res.kind = 'reservation'
          AND rr.sessions IS NOT NULL
          AND TRIM(rr.sessions) != ''
      `);
    } catch { return null; }
  })();

  function parseSessions(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return [];
    let list;
    try { list = JSON.parse(raw); } catch { return []; }
    if (!Array.isArray(list)) return [];
    return list
      .map((s) => ({
        date: String(s?.date || '').slice(0, 10),
        start: formatTimeShort(s?.start) || '',
        end: formatTimeShort(s?.end) || '',
        done: Boolean(s?.done),
      }))
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date));
  }

  const HAS_SESSIONS = (() => {
    try { return database.prepare('PRAGMA table_info(reservation_resources)').all().some((c) => c.name === 'sessions'); }
    catch { return false; }
  })();

  // Toggle one session's « préparé » flag, matched by (reservationId, resourceId, date, start).
  function setSessionDone({ reservationId, resourceId, date, start, done } = {}) {
    if (!HAS_SESSIONS) return { error: 'NO_COLUMN' };
    const row = database.prepare('SELECT sessions FROM reservation_resources WHERE reservationId = ? AND resourceId = ?')
      .get(Number(reservationId), Number(resourceId));
    if (!row) return { error: 'NOT_FOUND' };
    let list;
    try { list = JSON.parse(row.sessions || '[]'); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    const wantStart = formatTimeShort(start) || String(start || '');
    let matched = false;
    const next = list.map((s) => {
      if (!matched && String(s?.date || '') === String(date) && (formatTimeShort(s?.start) || String(s?.start || '')) === wantStart) {
        matched = true;
        return { ...s, done: Boolean(done) };
      }
      return s;
    });
    if (!matched) return { error: 'SESSION_NOT_FOUND' };
    database.prepare('UPDATE reservation_resources SET sessions = ? WHERE reservationId = ? AND resourceId = ?')
      .run(JSON.stringify(next), Number(reservationId), Number(resourceId));
    return { ok: true, done: Boolean(done) };
  }

  return {
    cardsInRange({ from, to } = {}) {
      if (!stmt) return {};
      const lo = String(from || '');
      const hi = String(to || '');
      const rows = stmt.all();
      const result = {};
      for (const r of rows) {
        const name = `${r.firstName || ''} ${r.lastName || ''}`.trim();
        const clientName = name || (r.icalOriginalSummary && String(r.icalOriginalSummary).trim()) || `Réservation #${r.reservationId}`;
        for (const s of parseSessions(r.sessions)) {
          if (lo && s.date < lo) continue;
          if (hi && s.date > hi) continue;
          if (!result[s.date]) result[s.date] = { items: [] };
          result[s.date].items.push({
            reservationId: r.reservationId,
            resourceId: r.resourceId,
            name: r.name || 'Ressource',
            clientName,
            propertyName: r.propertyName || '',
            date: s.date,
            start: s.start,
            end: s.end,
            done: s.done,
          });
        }
      }
      for (const date of Object.keys(result)) {
        result[date].items.sort((a, b) =>
          (a.start || '').localeCompare(b.start || '')
          || (a.name || '').localeCompare(b.name || '', 'fr')
          || a.clientName.localeCompare(b.clientName, 'fr')
          || a.reservationId - b.reservationId);
      }
      return result;
    },

    setSessionDone,
  };
}

const db = require('../database');
const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
