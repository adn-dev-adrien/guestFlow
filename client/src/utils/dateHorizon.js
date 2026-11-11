import { MAX_HORIZON_YEARS, HORIZON_MESSAGE, PAST_HORIZON_MESSAGE } from '../constants/dateHorizon';
import { localIsoToday } from './isoDay';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function shiftYears(today, years) {
  const year = Number(today.slice(0, 4)) + years;
  const sameDay = `${year}${today.slice(4)}`;
  const d = new Date(`${sameDay}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === sameDay ? sameDay : `${year}-02-28`;
}

/**
 * The last day a date may name: today plus MAX_HORIZON_YEARS years, a 29 February landing on the 28th
 * (specs/reservations-backend-mvc.md rule 13). The server judges; this only keeps the screens from
 * sending what it refuses.
 */
export function horizonEnd(today = localIsoToday()) {
  return shiftYears(today, MAX_HORIZON_YEARS);
}

/** The first day a date may name: today minus MAX_HORIZON_YEARS years (rule 13, reading of 2026-11-02). */
export function horizonStart(today = localIsoToday()) {
  return shiftYears(today, -MAX_HORIZON_YEARS);
}

/** Whether `iso` lies past the horizon's end. */
export function dateBeyondHorizon(iso, today = localIsoToday()) {
  return ISO_DAY.test(String(iso || '')) && iso > horizonEnd(today);
}

/** The refusal of a date outside the window — the past or the future message — or ''. */
export function dateWindowMessage(iso, today = localIsoToday()) {
  if (!ISO_DAY.test(String(iso || ''))) return '';
  if (iso < horizonStart(today)) return PAST_HORIZON_MESSAGE;
  if (iso > horizonEnd(today)) return HORIZON_MESSAGE;
  return '';
}
