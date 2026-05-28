/**
 * calendarVisuals — pure date / percentage / colour / label helpers for the reservation calendar.
 * No React, no side effects. Extracted verbatim from CalendarPage so the day-cell gradient math,
 * occupancy geometry and labels live in one testable place.
 */
import { getPlatformColor } from '../constants/platforms';
import { getBlockedNightConflictInfo } from './reservationConflicts';

export const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
export const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

// Time window for the proportional day fill: 8h → 21h (13h range).
export const DAY_START = 8;
export const DAY_END = 21;
export const DAY_RANGE = DAY_END - DAY_START;

export const CLEANING_COLOR = '#e53935';
export const BLOCKED_NIGHT_COLOR = '#ff9800'; // Orange pour les nuits bloquées
export const ZONE_COLORS = { A: '#1976d2', B: '#388e3c', C: '#f57c00' };

export function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export function formatDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function shiftDate(dateStr, daysDelta) {
  if (!dateStr) return '';
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + daysDelta);
  return formatDate(date.getFullYear(), date.getMonth(), date.getDate());
}

export function timeToHour(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h + (m || 0) / 60;
}

export function hourToPercent(hour) {
  return Math.max(0, Math.min(100, ((hour - DAY_START) / DAY_RANGE) * 100));
}

export function getReservationColor(platform) {
  return getPlatformColor(platform);
}

export function getBlockedNightInfo(dateStr, reservations) {
  const blockedNightInfo = getBlockedNightConflictInfo(dateStr, reservations);
  if (!blockedNightInfo) return null;

  if (blockedNightInfo.type === 'early-arrival') {
    return {
      ...blockedNightInfo,
      startPct: hourToPercent(17),
      endPct: 100,
      client: blockedNightInfo.reservation,
    };
  }

  if (blockedNightInfo.type === 'late-departure-evening') {
    return {
      ...blockedNightInfo,
      startPct: hourToPercent(timeToHour(blockedNightInfo.reservation?.checkOutTime || '10:00')),
      endPct: 100,
      client: blockedNightInfo.reservation,
    };
  }

  if (blockedNightInfo.type === 'late-departure-morning') {
    return {
      ...blockedNightInfo,
      startPct: 0,
      endPct: hourToPercent(10),
      client: blockedNightInfo.reservation,
    };
  }

  return null;
}

// Whether a reservation has visible mid-stay days within the given month.
export function resHasMidDays(res, y, m, dim) {
  const monthStartStr = formatDate(y, m, 1);
  const monthEndStr = formatDate(y, m, dim);
  const s = new Date(res.startDate); s.setDate(s.getDate() + 1);
  const firstMid = formatDate(s.getFullYear(), s.getMonth(), s.getDate());
  const e = new Date(res.endDate); e.setDate(e.getDate() - 1);
  const lastMid = formatDate(e.getFullYear(), e.getMonth(), e.getDate());
  if (firstMid > lastMid) return false;
  return firstMid <= monthEndStr && lastMid >= monthStartStr;
}

export function compactName(firstName, lastName) {
  const f = (firstName || '').charAt(0);
  const l = lastName || '';
  const full = f ? `${f}. ${l}` : l;
  return full.length > 8 ? full.slice(0, 7) + '…' : full;
}
