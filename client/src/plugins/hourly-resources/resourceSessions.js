/**
 * Client helpers for hourly-scheduled resource sessions (specs/resource-hourly-scheduling.md).
 *
 * UI-only: enumerate the stay days and build the slot-stepped time options. No money here: every price
 * comes from the server (specs/resource-supplements-total-server-side.md rule 8).
 */

export function toMinutes(time) {
  const [h, m] = String(time || '').split(':').map((n) => Number(n));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function minutesToTime(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Inclusive list of YYYY-MM-DD between start and end (UTC math to avoid TZ day-shift).
export function enumerateStayDates(startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate || ''))) return [];
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  let cur = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  const out = [];
  while (cur <= end) {
    const d = new Date(cur);
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
    cur += 24 * 60 * 60 * 1000;
  }
  return out;
}

// Slot-stepped HH:MM options within [openTime, closeTime].
export function timeOptions(openTime, closeTime, slotMinutes) {
  const step = Math.max(1, Number(slotMinutes) || 30);
  const lo = toMinutes(openTime || '00:00');
  const hi = toMinutes(closeTime || '23:59');
  const out = [];
  for (let t = lo; t <= hi; t += step) out.push(minutesToTime(t));
  return out;
}

// True when the resource is hourly-scheduled (drives the fiche session editor + planning card).
export function isHourlyScheduled(resource) {
  return Boolean(resource) && Number(resource.showsPlanningCard || 0) === 1 && resource.priceType === 'per_hour';
}

// The window a session may use on one day of the stay: the opening hours, narrowed to the check-in
// on arrival day and to the check-out on departure day — the same bounds the arrival SAS applies
// (specs/plugins-phase-3c-hourly-resources.md rule 31).
export function dayWindow(date, { stay = {}, openTime, closeTime }) {
  let lo = toMinutes(openTime || '00:00');
  let hi = toMinutes(closeTime || '23:59');
  if (date === stay.startDate && stay.checkInTime) lo = Math.max(lo, toMinutes(stay.checkInTime));
  if (date === stay.endDate && stay.checkOutTime) hi = Math.min(hi, toMinutes(stay.checkOutTime));
  return { lo, hi };
}

const overlaps = (a, b) => a.date === b.date && toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);

// The session « Ajouter une séance » proposes: the first slot of the stay, in its day's window, that
// overlaps none of the sessions already placed (rule 31). Null when the stay has no room left.
export function nextFreeSession({ days, times, sessions = [], durationMinutes, stay, openTime, closeTime }) {
  for (const date of days) {
    const { lo, hi } = dayWindow(date, { stay, openTime, closeTime });
    for (const start of times) {
      const s = toMinutes(start);
      const e = s + durationMinutes;
      if (s < lo || e > hi) continue;
      const candidate = { date, start, end: minutesToTime(e) };
      if (!sessions.some((existing) => overlaps(existing, candidate))) return candidate;
    }
  }
  return null;
}
