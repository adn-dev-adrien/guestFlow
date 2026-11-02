import { MAX_HORIZON_YEARS } from '../constants/dateHorizon';
import { localIsoToday } from './isoDay';

/**
 * The last day a date may name: today plus MAX_HORIZON_YEARS years, a 29 February landing on the 28th
 * (specs/reservations-backend-mvc.md rule 13). The server judges; this only keeps the screens from
 * sending what it refuses.
 */
export function horizonEnd(today = localIsoToday()) {
  const year = Number(today.slice(0, 4)) + MAX_HORIZON_YEARS;
  const sameDay = `${year}${today.slice(4)}`;
  const d = new Date(`${sameDay}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === sameDay ? sameDay : `${year}-02-28`;
}

/** Whether `iso` lies past the horizon. The past is never limited. */
export function dateBeyondHorizon(iso, today = localIsoToday()) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) && iso > horizonEnd(today);
}
