/**
 * Time-banded hourly pricing for scheduled resources (specs/resource-hourly-scheduling.md §3.3/§3.5).
 *
 * A resource booked by the hour is priced from a two-band grid: a day rate before an evening switch
 * time, an evening rate from that switch to the close. Bookings are made in slot steps (30 min) with a
 * mandatory first whole hour. The same code prices guest sessions (on a reservation) and external
 * standalone bookings — only the rate pair differs (passed in by the caller).
 *
 * Pure module: no DB, no Date.now(). All money rounded to 2 decimals, never negative.
 */

function toMinutes(time) {
  const [h, m] = String(time || '').split(':').map((n) => Number(n));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * cfg: { dayRate, eveningRate, eveningStart ('HH:MM' | null), slotMinutes = 30 }.
 * The evening rate falls back to the day rate when ≤ 0 or when eveningStart is empty.
 */
function normalizeConfig(cfg = {}) {
  const dayRate = Math.max(0, Number(cfg.dayRate) || 0);
  const eveningRateRaw = Number(cfg.eveningRate) || 0;
  const hasEvening = Boolean(cfg.eveningStart) && eveningRateRaw > 0;
  return {
    dayRate,
    eveningRate: hasEvening ? eveningRateRaw : dayRate,
    eveningStart: hasEvening ? toMinutes(cfg.eveningStart) : Infinity,
    slotMinutes: Math.max(1, Number(cfg.slotMinutes) || 30),
  };
}

// Price the minutes [fromMin, toMin) over the banded grid, walking in slot steps so a slice that
// crosses the evening switch is billed at each side's band.
function priceMinutes(fromMin, toMin, normCfg) {
  if (toMin <= fromMin) return 0;
  const { dayRate, eveningRate, eveningStart, slotMinutes } = normCfg;
  let total = 0;
  for (let t = fromMin; t < toMin; t += slotMinutes) {
    const sliceMinutes = Math.min(slotMinutes, toMin - t);
    const rate = t < eveningStart ? dayRate : eveningRate;
    total += rate * (sliceMinutes / 60);
  }
  return total;
}

/** Gross price of one session's [start, end) range (no free-hour deduction). */
function priceRange(start, end, cfg = {}) {
  return round2(priceMinutes(toMinutes(start), toMinutes(end), normalizeConfig(cfg)));
}

/**
 * Validate a session against the resource window/granularity.
 * cfg adds: openTime, closeTime ('HH:MM'), minMinutes. Returns true when billable.
 */
function isValidSession(session, cfg = {}) {
  if (!session) return false;
  const s = toMinutes(session.start);
  const e = toMinutes(session.end);
  if (!(e > s)) return false;
  const slot = Math.max(1, Number(cfg.slotMinutes) || 30);
  if (s % slot !== 0 || e % slot !== 0) return false;
  if (cfg.openTime && s < toMinutes(cfg.openTime)) return false;
  if (cfg.closeTime && e > toMinutes(cfg.closeTime)) return false;
  const min = Math.max(0, Number(cfg.minMinutes) || 0);
  if (min > 0 && (e - s) < min) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(session.date || ''))) return false;
  return true;
}

/**
 * Price a set of sessions for one reservation-resource (or a single standalone booking).
 *  - cfg: { dayRate, eveningRate, eveningStart, slotMinutes, openTime, closeTime, minMinutes }
 *  - freeMinutes: free allowance applied ONCE, to the earliest valid session's first minutes.
 * Returns { totalPrice, grossPrice, billedHours, unitPrice, validSessions }.
 */
function priceSessions(sessions, cfg = {}, freeMinutes = 0) {
  const norm = normalizeConfig(cfg);
  const valid = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => isValidSession(s, cfg))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (toMinutes(a.start) - toMinutes(b.start)));

  if (valid.length === 0) {
    return { totalPrice: 0, grossPrice: 0, billedHours: 0, unitPrice: 0, validSessions: [] };
  }

  const gross = valid.reduce((sum, s) => sum + priceMinutes(toMinutes(s.start), toMinutes(s.end), norm), 0);
  const totalMinutes = valid.reduce((sum, s) => sum + (toMinutes(s.end) - toMinutes(s.start)), 0);

  // Free allowance: applied once, to the earliest session's first `freeMinutes` (capped to its length).
  const free = Math.max(0, Number(freeMinutes) || 0);
  const first = valid[0];
  const firstStart = toMinutes(first.start);
  const freeApplied = Math.min(free, toMinutes(first.end) - firstStart);
  const freeValue = freeApplied > 0 ? priceMinutes(firstStart, firstStart + freeApplied, norm) : 0;

  const billedMinutes = Math.max(0, totalMinutes - freeApplied);
  const billedHours = round2(billedMinutes / 60);
  const totalPrice = Math.max(0, round2(gross - freeValue));
  const unitPrice = billedHours > 0 ? round2(totalPrice / billedHours) : 0;

  return { totalPrice, grossPrice: round2(gross), billedHours, unitPrice, validSessions: valid };
}

module.exports = { toMinutes, priceRange, priceSessions, isValidSession, normalizeConfig };
