/**
 * Client helpers for hourly-scheduled resource sessions (specs/resource-hourly-scheduling.md).
 *
 * UI-only: enumerate the stay days, build the slot-stepped time options, and a PREVIEW pricer that
 * mirrors the server's time-banded grid (server stays authoritative — this only drives the live total
 * the operator sees before saving, e.g. the standalone booking dialog).
 */

export function toMinutes(time) {
  const [h, m] = String(time || '').split(':').map((n) => Number(n));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function minutesToTime(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

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

function normalizeConfig(cfg = {}) {
  const dayRate = Math.max(0, Number(cfg.dayRate) || 0);
  const eveningRaw = Number(cfg.eveningRate) || 0;
  const hasEvening = Boolean(cfg.eveningStart) && eveningRaw > 0;
  return {
    dayRate,
    eveningRate: hasEvening ? eveningRaw : dayRate,
    eveningStart: hasEvening ? toMinutes(cfg.eveningStart) : Infinity,
    slotMinutes: Math.max(1, Number(cfg.slotMinutes) || 30),
  };
}

function priceMinutes(fromMin, toMin, norm) {
  if (toMin <= fromMin) return 0;
  let total = 0;
  for (let t = fromMin; t < toMin; t += norm.slotMinutes) {
    const sliceMinutes = Math.min(norm.slotMinutes, toMin - t);
    total += (t < norm.eveningStart ? norm.dayRate : norm.eveningRate) * (sliceMinutes / 60);
  }
  return total;
}

// Preview total for a single [start, end) range (free first hour applied). Mirrors the server.
export function previewRangeTotal(start, end, cfg = {}, freeMinutes = 0) {
  const norm = normalizeConfig(cfg);
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (e <= s) return 0;
  const gross = priceMinutes(s, e, norm);
  const freeApplied = Math.min(Math.max(0, Number(freeMinutes) || 0), e - s);
  const freeValue = freeApplied > 0 ? priceMinutes(s, s + freeApplied, norm) : 0;
  return Math.max(0, round2(gross - freeValue));
}

// Preview total for the fiche sessions (free hour once, on the earliest session). Mirrors the server.
export function previewSessionsTotal(sessions, cfg = {}, freeMinutes = 0) {
  const norm = normalizeConfig(cfg);
  const valid = (Array.isArray(sessions) ? sessions : [])
    .filter((x) => x && toMinutes(x.end) > toMinutes(x.start))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (toMinutes(a.start) - toMinutes(b.start)));
  if (!valid.length) return 0;
  const gross = valid.reduce((sum, x) => sum + priceMinutes(toMinutes(x.start), toMinutes(x.end), norm), 0);
  const first = valid[0];
  const fs = toMinutes(first.start);
  const freeApplied = Math.min(Math.max(0, Number(freeMinutes) || 0), toMinutes(first.end) - fs);
  const freeValue = freeApplied > 0 ? priceMinutes(fs, fs + freeApplied, norm) : 0;
  return Math.max(0, round2(gross - freeValue));
}

// True when the resource is hourly-scheduled (drives the fiche session editor + planning card).
export function isHourlyScheduled(resource) {
  return Boolean(resource) && Number(resource.showsPlanningCard || 0) === 1 && resource.priceType === 'per_hour';
}
