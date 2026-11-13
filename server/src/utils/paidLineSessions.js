/**
 * PAID LINE SESSIONS — a session added to an hourly line that is already paid is a NEW line (specs/pricing-components.md §3 rule 85, owner Q-C7).
 *
 * `splitPaidLineSessions(db, reservationId, body)` returns the PUT body with, for each posted resource line that names a PAID stored line
 * (`lineId`, settled by at least one payment allocation) and carries sessions the stored line does not hold, those sessions moved to a line the
 * save appends (`newLine`): the paid line keeps the sessions and the hours it was sold with, the new hours are a sale of their own, priced
 * and collected on their own. An unpaid line is untouched: its sessions grow with it and its evening component with them.
 *
 * Pure of the clock; reads the stored sessions and the allocations of the stay; writes nothing.
 */
const { create } = require('../models/ports/stayRepository');
const { roundMoney } = require('./pricing/money');

const sameSession = (a, b) => String(a.date) === String(b.date) && String(a.start) === String(b.start) && String(a.end) === String(b.end);
const minutesOf = (time) => {
  const [h, m] = String(time || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
};
const hoursOf = (sessions) => roundMoney(sessions.reduce((sum, s) => sum + Math.max(0, minutesOf(s.end) - minutesOf(s.start)), 0) / 60);

function splitPaidLineSessions(db, reservationId, body) {
  if (!Array.isArray(body.resources) || !body.resources.some((r) => r && r.lineId != null && Array.isArray(r.sessions) && r.sessions.length)) return body;
  const paid = new Set(Object.values(create(db).lineFacts(reservationId))
    .filter((fact) => fact.table === 'resource' && fact.settledCents > 0).map((fact) => Number(fact.lineId)));
  if (paid.size === 0) return body;
  const stored = new Map(db.prepare('SELECT lineId, sessions, quantity FROM reservation_resources WHERE reservationId = ?').all(Number(reservationId))
    .map((row) => { let sessions = []; try { sessions = JSON.parse(row.sessions || '[]'); } catch { sessions = []; } return [Number(row.lineId), { sessions, quantity: Number(row.quantity || 0) }]; }));
  const appended = [];
  const resources = body.resources.map((line) => {
    const held = line && line.lineId != null && paid.has(Number(line.lineId)) ? stored.get(Number(line.lineId)) : null;
    if (!held || !Array.isArray(line.sessions)) return line;
    const added = line.sessions.filter((s) => !held.sessions.some((h) => sameSession(h, s)));
    if (added.length === 0) return line;
    const hours = hoursOf(added);
    appended.push({
      resourceId: line.resourceId, quantity: hours, offered: false, inComplement: 0, sessions: added.map(({ date, start, end }) => ({ date, start, end })), newLine: true,
    });
    return { ...line, sessions: line.sessions.filter((s) => !added.includes(s)), quantity: Math.max(held.quantity, roundMoney(Number(line.quantity || 0) - hours)) };
  });
  return { ...body, resources: [...resources, ...appended] };
}

module.exports = { splitPaidLineSessions };
