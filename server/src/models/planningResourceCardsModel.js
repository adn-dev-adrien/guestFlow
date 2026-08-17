/**
 * Resource-driven planning cards model — per-session cards for the Planning page.
 * Spec: specs/resource-hourly-scheduling.md §3.4.
 *
 * Returns a `{ 'YYYY-MM-DD': { items: [{ reservationId, resourceId, name, clientName, propertyName,
 * date, start, end, done }] } }` map for the requested `[from, to]` window.
 *
 * An hourly-scheduled resource (`resources.showsPlanningCard = 1`) carries its per-reservation sessions
 * on `reservation_resources.sessions` (JSON `[{ date, start, end, done, ignitionDone }]`). One card per
 * session whose `date` ∈ `[from, to]`. Mirrors `planningOptionCardsModel.js` (devis excluded — only real
 * reservations).
 *
 * A resource that takes hours to warm up (`resources.heatUpMinutes`) also produces an « allumage » card
 * on the day the operator must START it — specs/resource-ignition-task.md. Only when that moment falls
 * on an EARLIER day: a 17:00 session with 8 h of heat-up is lit the same morning and needs no reminder,
 * a 09:00 one has to be lit the night before.
 */

const { formatTimeShort } = require('../utils/dateFr');

function buildModel(database) {
  // The thermal columns landed with specs/hourly-resource-quantity-and-sas-scheduling.md; a minimal
  // test schema without them simply never produces an ignition card.
  const HAS_THERMAL = (() => {
    try {
      const cols = database.prepare('PRAGMA table_info(resources)').all().map((c) => c.name);
      return cols.includes('heatUpMinutes') && cols.includes('heatRetentionMinutes');
    } catch { return false; }
  })();
  const THERMAL_SELECT = HAS_THERMAL
    ? 'rs.heatUpMinutes AS heatUpMinutes, rs.heatRetentionMinutes AS heatRetentionMinutes,'
    : '0 AS heatUpMinutes, 0 AS heatRetentionMinutes,';
  const stmt = (() => {
    try {
      return database.prepare(`
        SELECT
          rr.reservationId AS reservationId,
          rr.resourceId AS resourceId,
          rr.sessions AS sessions,
          rs.name AS name,
          ${THERMAL_SELECT}
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
        ignitionDone: Boolean(s?.ignitionDone),
      }))
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date));
  }

  // specs/resource-ignition-task.md §3 — when must the operator light this resource, and does that
  // land on an earlier day? `HH:MM` + a date, minus the heat-up, in plain minutes-since-midnight.
  const MINUTES_PER_DAY = 1440;
  const toMinutes = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const toHhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const shiftDate = (iso, days) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  // Absolute minutes since an arbitrary epoch, so « the evening before » compares with « this morning ».
  const absoluteMinutes = (dateIso, hhmm) => {
    const minutes = toMinutes(hhmm);
    if (minutes == null) return null;
    return Math.round(new Date(`${dateIso}T00:00:00Z`).getTime() / 60000) + minutes;
  };
  // The operator's day starts at 08:00: before that, « allumer le matin même » is not a thing — the
  // fire has to be lit the evening before (specs/resource-ignition-task.md §3 rule 2). This is the
  // whole point of issue #13: a 09:00 session with 8 h of heat-up ignites at 01:00, which is « la
  // veille » in practice even though the clock says the same calendar day.
  const DAY_START_MINUTES = 8 * 60;
  function ignitionMoment(session, heatUpMinutes) {
    const start = toMinutes(session.start);
    if (start == null || heatUpMinutes <= 0) return null;
    const shifted = start - heatUpMinutes; // minutes relative to the session's own midnight
    if (shifted >= DAY_START_MINUTES) return null; // lit that very morning — nothing to remind
    if (shifted >= 0) {
      // Ignition in the small hours: the task belongs to the previous EVENING, so it lands on the
      // previous day with no time → bottom of that day's stream (the planning's time-less slot).
      return { date: shiftDate(session.date, -1), time: null, at: toHhmm(shifted), dayOffset: 1 };
    }
    const daysBefore = Math.ceil(-shifted / MINUTES_PER_DAY);
    const minuteOfDay = ((shifted % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const at = toHhmm(minuteOfDay);
    return { date: shiftDate(session.date, -daysBefore), time: at, at, dayOffset: daysBefore };
  }
  // « Still hot »: another session of the SAME resource ends within the retention window before this
  // one starts (§3 rule 3) — the bath kept its heat, nothing to light.
  function stillHot({ session, siblings, heatRetentionMinutes }) {
    if (heatRetentionMinutes <= 0) return false;
    const startAt = absoluteMinutes(session.date, session.start);
    if (startAt == null) return false;
    return siblings.some((other) => {
      if (other === session) return false;
      const endAt = absoluteMinutes(other.date, other.end || other.start);
      if (endAt == null || endAt > startAt) return false;
      return startAt - endAt <= heatRetentionMinutes;
    });
  }

  const HAS_SESSIONS = (() => {
    try { return database.prepare('PRAGMA table_info(reservation_resources)').all().some((c) => c.name === 'sessions'); }
    catch { return false; }
  })();

  // Toggle one session's « préparé » flag, matched by (reservationId, resourceId, date, start).
  // `kind: 'ignition'` ticks the « démarrer » task instead of the session's own « préparé » — two
  // distinct gestures on the same session (specs/resource-ignition-task.md §3 rule 6).
  function setSessionDone({ reservationId, resourceId, date, start, done, kind } = {}) {
    const field = kind === 'ignition' ? 'ignitionDone' : 'done';
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
        return { ...s, [field]: Boolean(done) };
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
      // Every session of a given resource, whoever booked it: the retention check has to see the
      // other guests' uses too (specs/resource-ignition-task.md §3 rule 3).
      const sessionsByResource = new Map();
      const parsedRows = rows.map((r) => {
        const sessions = parseSessions(r.sessions);
        const key = Number(r.resourceId);
        if (!sessionsByResource.has(key)) sessionsByResource.set(key, []);
        sessionsByResource.get(key).push(...sessions);
        return { row: r, sessions };
      });
      const result = {};
      const push = (date, item) => {
        if (lo && date < lo) return;
        if (hi && date > hi) return;
        if (!result[date]) result[date] = { items: [] };
        result[date].items.push(item);
      };
      for (const { row: r, sessions } of parsedRows) {
        const name = `${r.firstName || ''} ${r.lastName || ''}`.trim();
        const clientName = name || (r.icalOriginalSummary && String(r.icalOriginalSummary).trim()) || `Réservation #${r.reservationId}`;
        const heatUpMinutes = Math.max(0, Number(r.heatUpMinutes) || 0);
        const heatRetentionMinutes = Math.max(0, Number(r.heatRetentionMinutes) || 0);
        const base = {
          reservationId: r.reservationId,
          resourceId: r.resourceId,
          name: r.name || 'Ressource',
          clientName,
          propertyName: r.propertyName || '',
        };
        for (const s of sessions) {
          push(s.date, { ...base, kind: 'session', date: s.date, start: s.start, end: s.end, done: s.done });

          const ignition = ignitionMoment(s, heatUpMinutes);
          if (!ignition) continue;
          if (stillHot({ session: s, siblings: sessionsByResource.get(Number(r.resourceId)) || [], heatRetentionMinutes })) continue;
          push(ignition.date, {
            ...base,
            kind: 'ignition',
            // The card is addressed by the SESSION it prepares — that is where its checkbox lives.
            date: s.date,
            start: s.start,
            cardDate: ignition.date,
            time: ignition.time,
            ignitionAt: ignition.at,
            dayOffset: ignition.dayOffset,
            sessionDate: s.date,
            sessionStart: s.start,
            done: s.ignitionDone,
          });
        }
      }
      for (const date of Object.keys(result)) {
        result[date].items.sort((a, b) =>
          ((a.time || a.start) || '').localeCompare((b.time || b.start) || '')
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
